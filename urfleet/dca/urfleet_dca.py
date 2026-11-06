#!/usr/bin/env python3
"""
UrFleet DCA — Data Collection Agent
====================================

Installed at each client site. Discovers networked printers over SNMP,
collects meters, supply levels and device conditions, and sends them to the
UrFleet cloud (Supabase edge function `dca-ingest`).

* Zero third-party dependencies (Python 3.8+ standard library only), so it can
  be frozen into a single Windows .exe with PyInstaller.
* Built-in SNMP v1 / v2c client (BER encoder/decoder, GET / GETNEXT / GETBULK).
* Printer-MIB (RFC 3805) + Host-Resources-MIB collection, plus vendor counter
  profiles for mono/colour split (HP, Xerox, Ricoh, Kyocera, Lexmark, Brother,
  Canon, Konica Minolta, Toshiba, Sharp) that are validated against the
  standard total before being trusted.
* Offline spool: if the cloud is unreachable, payloads are queued on disk and
  replayed oldest-first on the next cycle.
* Remote configuration and commands (rescan, collect_now, ping, ...) are
  delivered in the ingest response, so no inbound firewall ports are needed.

Privacy (PIPA / PIPEDA): the DCA collects device telemetry only — meters,
supply levels, model/serial, IP/MAC, device status. It never collects print
job content, document names or end-user identities.

Usage
-----
  urfleet_dca.py run      [-c dca.json]        # daemon loop (service mode)
  urfleet_dca.py once     [-c dca.json]        # one discovery + upload cycle
  urfleet_dca.py scan     --range 192.168.1.0/24 [--community public] [--json]
  urfleet_dca.py probe    --ip 192.168.1.50    # full collection for one device, printed
  urfleet_dca.py walk     --ip 192.168.1.50 --oid 1.3.6.1.2.1.43  # diagnostics
  urfleet_dca.py init     --endpoint URL --key KEY [--range ...]  # write config file
  urfleet_dca.py version
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import logging
import logging.handlers
import os
import platform
import random
import re
import socket
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

__version__ = "1.0.0"
AGENT_NAME = "UrFleet-DCA"

log = logging.getLogger("urfleet.dca")

# =============================================================================
# BER / ASN.1 encoding (subset needed for SNMP)
# =============================================================================

TAG_INTEGER = 0x02
TAG_OCTET_STRING = 0x04
TAG_NULL = 0x05
TAG_OID = 0x06
TAG_SEQUENCE = 0x30
TAG_IPADDRESS = 0x40
TAG_COUNTER32 = 0x41
TAG_GAUGE32 = 0x42
TAG_TIMETICKS = 0x43
TAG_OPAQUE = 0x44
TAG_COUNTER64 = 0x46
TAG_NO_SUCH_OBJECT = 0x80
TAG_NO_SUCH_INSTANCE = 0x81
TAG_END_OF_MIB_VIEW = 0x82

PDU_GET = 0xA0
PDU_GETNEXT = 0xA1
PDU_RESPONSE = 0xA2
PDU_SET = 0xA3
PDU_GETBULK = 0xA5

UNSIGNED_TAGS = (TAG_COUNTER32, TAG_GAUGE32, TAG_TIMETICKS, TAG_COUNTER64)
EXCEPTION_TAGS = (TAG_NO_SUCH_OBJECT, TAG_NO_SUCH_INSTANCE, TAG_END_OF_MIB_VIEW)


class SnmpError(Exception):
    pass


class SnmpTimeout(SnmpError):
    pass


class NoSuch:
    """Marker for noSuchObject / noSuchInstance / endOfMibView."""

    __slots__ = ("tag",)

    def __init__(self, tag: int):
        self.tag = tag

    @property
    def end_of_mib(self) -> bool:
        return self.tag == TAG_END_OF_MIB_VIEW

    def __repr__(self) -> str:  # pragma: no cover - debug only
        return {0x80: "noSuchObject", 0x81: "noSuchInstance", 0x82: "endOfMibView"}[self.tag]

    def __bool__(self) -> bool:
        return False


def ber_length(n: int) -> bytes:
    if n < 0x80:
        return bytes([n])
    out = []
    while n:
        out.append(n & 0xFF)
        n >>= 8
    return bytes([0x80 | len(out)]) + bytes(reversed(out))


def ber_tlv(tag: int, payload: bytes) -> bytes:
    return bytes([tag]) + ber_length(len(payload)) + payload


def ber_int(value: int, tag: int = TAG_INTEGER) -> bytes:
    if tag in UNSIGNED_TAGS:
        if value == 0:
            body = b"\x00"
        else:
            body = value.to_bytes((value.bit_length() + 7) // 8, "big")
            if body[0] & 0x80:
                body = b"\x00" + body
    else:
        length = max(1, (value + (value < 0)).bit_length() // 8 + 1)
        body = value.to_bytes(length, "big", signed=True)
    return ber_tlv(tag, body)


def ber_octets(value: bytes, tag: int = TAG_OCTET_STRING) -> bytes:
    return ber_tlv(tag, value)


def ber_null() -> bytes:
    return b"\x05\x00"


def oid_to_tuple(oid: str | Tuple[int, ...]) -> Tuple[int, ...]:
    if isinstance(oid, tuple):
        return oid
    return tuple(int(x) for x in oid.strip(".").split(".") if x != "")


def oid_to_str(oid: Tuple[int, ...]) -> str:
    return ".".join(str(x) for x in oid)


def ber_oid(oid: str | Tuple[int, ...]) -> bytes:
    parts = oid_to_tuple(oid)
    if len(parts) < 2:
        raise ValueError("OID needs at least two arcs")
    body = bytearray([parts[0] * 40 + parts[1]])
    for arc in parts[2:]:
        if arc < 0x80:
            body.append(arc)
            continue
        chunk = []
        while arc:
            chunk.append(arc & 0x7F)
            arc >>= 7
        chunk.reverse()
        for i, c in enumerate(chunk):
            body.append(c | (0x80 if i < len(chunk) - 1 else 0))
    return ber_tlv(TAG_OID, bytes(body))


def ber_sequence(*items: bytes, tag: int = TAG_SEQUENCE) -> bytes:
    return ber_tlv(tag, b"".join(items))


def ber_decode(data: bytes, pos: int = 0) -> Tuple[int, bytes, int]:
    """Return (tag, value_bytes, next_pos)."""
    if pos + 2 > len(data):
        raise SnmpError("truncated BER")
    tag = data[pos]
    length = data[pos + 1]
    pos += 2
    if length & 0x80:
        nbytes = length & 0x7F
        if nbytes == 0 or nbytes > 4 or pos + nbytes > len(data):
            raise SnmpError("bad BER length")
        length = int.from_bytes(data[pos : pos + nbytes], "big")
        pos += nbytes
    end = pos + length
    if end > len(data):
        raise SnmpError("truncated BER value")
    return tag, data[pos:end], end


def ber_decode_all(data: bytes) -> List[Tuple[int, bytes]]:
    items = []
    pos = 0
    while pos < len(data):
        tag, val, pos = ber_decode(data, pos)
        items.append((tag, val))
    return items


def decode_oid(body: bytes) -> Tuple[int, ...]:
    if not body:
        return ()
    first = body[0]
    arcs = [first // 40, first % 40] if first < 80 else [2, first - 80]
    val = 0
    for b in body[1:]:
        val = (val << 7) | (b & 0x7F)
        if not b & 0x80:
            arcs.append(val)
            val = 0
    return tuple(arcs)


def decode_value(tag: int, body: bytes) -> Any:
    if tag == TAG_INTEGER:
        return int.from_bytes(body, "big", signed=True) if body else 0
    if tag in UNSIGNED_TAGS:
        return int.from_bytes(body, "big", signed=False) if body else 0
    if tag in (TAG_OCTET_STRING, TAG_OPAQUE):
        return bytes(body)
    if tag == TAG_NULL:
        return None
    if tag == TAG_OID:
        return decode_oid(body)
    if tag == TAG_IPADDRESS:
        return ".".join(str(b) for b in body)
    if tag in EXCEPTION_TAGS:
        return NoSuch(tag)
    return bytes(body)


def encode_value(value: Any) -> bytes:
    """Encode a python value into an SNMP varbind value (used by tests/simulator)."""
    if value is None:
        return ber_null()
    if isinstance(value, NoSuch):
        return bytes([value.tag, 0])
    if isinstance(value, bool):
        return ber_int(int(value))
    if isinstance(value, int):
        return ber_int(value)
    if isinstance(value, tuple) and len(value) == 2 and isinstance(value[0], str) and value[0] in (
        "counter32", "gauge32", "timeticks", "counter64", "oid", "ip",
    ):
        kind, v = value
        if kind == "oid":
            return ber_oid(v)
        if kind == "ip":
            return ber_octets(bytes(int(x) for x in v.split(".")), TAG_IPADDRESS)
        return ber_int(int(v), {"counter32": TAG_COUNTER32, "gauge32": TAG_GAUGE32,
                                "timeticks": TAG_TIMETICKS, "counter64": TAG_COUNTER64}[kind])
    if isinstance(value, str):
        return ber_octets(value.encode("utf-8"))
    if isinstance(value, (bytes, bytearray)):
        return ber_octets(bytes(value))
    raise TypeError(f"cannot encode {value!r}")


def build_message(version: int, community: str, pdu_tag: int, request_id: int,
                  varbinds: List[Tuple[str | Tuple[int, ...], bytes]],
                  err_status: int = 0, err_index: int = 0) -> bytes:
    vb = b"".join(ber_sequence(ber_oid(oid), val) for oid, val in varbinds)
    pdu = ber_sequence(ber_int(request_id), ber_int(err_status), ber_int(err_index),
                       ber_sequence(vb), tag=pdu_tag)
    return ber_sequence(ber_int(version), ber_octets(community.encode()), pdu)


def parse_message(data: bytes) -> Dict[str, Any]:
    tag, body, _ = ber_decode(data)
    if tag != TAG_SEQUENCE:
        raise SnmpError("not an SNMP message")
    parts = ber_decode_all(body)
    if len(parts) != 3:
        raise SnmpError("malformed SNMP message")
    version = decode_value(*parts[0])
    community = parts[1][1].decode("latin-1")
    pdu_tag, pdu_body = parts[2]
    pdu_parts = ber_decode_all(pdu_body)
    if len(pdu_parts) != 4:
        raise SnmpError("malformed PDU")
    request_id = decode_value(*pdu_parts[0])
    err_status = decode_value(*pdu_parts[1])
    err_index = decode_value(*pdu_parts[2])
    varbinds = []
    for vtag, vbody in ber_decode_all(pdu_parts[3][1]):
        if vtag != TAG_SEQUENCE:
            continue
        (otag, obody), (valtag, valbody) = ber_decode_all(vbody)[:2]
        varbinds.append((decode_oid(obody), valtag, decode_value(valtag, valbody)))
    return {
        "version": version, "community": community, "pdu": pdu_tag, "request_id": request_id,
        "error_status": err_status, "error_index": err_index, "varbinds": varbinds,
    }


# =============================================================================
# SNMP client
# =============================================================================

class SnmpClient:
    def __init__(self, host: str, community: str = "public", version: str = "2c",
                 port: int = 161, timeout: float = 1.5, retries: int = 1):
        self.host = host
        self.port = port
        self.community = community
        self.version = 0 if str(version) == "1" else 1
        self.timeout = timeout
        self.retries = retries

    def _request(self, pdu_tag: int, varbinds, err_status: int = 0, err_index: int = 0):
        req_id = random.randint(1, 0x7FFFFFFF)
        msg = build_message(self.version, self.community, pdu_tag, req_id, varbinds, err_status, err_index)
        last_exc: Exception = SnmpTimeout(f"{self.host}: timeout")
        for _attempt in range(self.retries + 1):
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                sock.settimeout(self.timeout)
                sock.sendto(msg, (self.host, self.port))
                deadline = time.monotonic() + self.timeout
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise SnmpTimeout(f"{self.host}: timeout")
                    sock.settimeout(remaining)
                    data, _addr = sock.recvfrom(65535)
                    try:
                        resp = parse_message(data)
                    except SnmpError:
                        continue
                    if resp["request_id"] != req_id:
                        continue
                    return resp
            except (socket.timeout, SnmpTimeout):
                last_exc = SnmpTimeout(f"{self.host}: timeout")
            except OSError as exc:
                last_exc = SnmpError(f"{self.host}: {exc}")
                break
            finally:
                sock.close()
        raise last_exc

    def get(self, oids: List[str]) -> Dict[str, Any]:
        """GET several OIDs. Returns {oid_str: value}; missing objects map to None.

        SNMPv1 agents answer noSuchName (error 2) for the whole PDU if any OID is
        missing, so on error we fall back to one-by-one requests.
        """
        out: Dict[str, Any] = {}
        if not oids:
            return out
        resp = self._request(PDU_GET, [(o, ber_null()) for o in oids])
        if resp["error_status"] != 0:
            if len(oids) == 1:
                return {oids[0]: None}
            for o in oids:
                try:
                    out.update(self.get([o]))
                except SnmpTimeout:
                    out[o] = None
            return out
        for oid, _tag, val in resp["varbinds"]:
            out[oid_to_str(oid)] = None if isinstance(val, NoSuch) else val
        for o in oids:
            out.setdefault(o.strip("."), None)
        return out

    def walk(self, base: str, max_rows: int = 2000) -> List[Tuple[Tuple[int, ...], Any]]:
        base_t = oid_to_tuple(base)
        rows: List[Tuple[Tuple[int, ...], Any]] = []
        current = base_t
        while len(rows) < max_rows:
            if self.version == 1:
                resp = self._request(PDU_GETBULK, [(current, ber_null())], 0, 25)
            else:
                resp = self._request(PDU_GETNEXT, [(current, ber_null())])
            if resp["error_status"] != 0 or not resp["varbinds"]:
                break
            progressed = False
            for oid, _tag, val in resp["varbinds"]:
                if isinstance(val, NoSuch) or oid[: len(base_t)] != base_t or oid <= current:
                    return rows
                rows.append((oid, val))
                current = oid
                progressed = True
            if not progressed:
                break
        return rows


# =============================================================================
# Printer knowledge
# =============================================================================

OID = {
    "sysDescr": "1.3.6.1.2.1.1.1.0",
    "sysObjectID": "1.3.6.1.2.1.1.2.0",
    "sysUpTime": "1.3.6.1.2.1.1.3.0",
    "sysContact": "1.3.6.1.2.1.1.4.0",
    "sysName": "1.3.6.1.2.1.1.5.0",
    "sysLocation": "1.3.6.1.2.1.1.6.0",
    "hrDeviceType": "1.3.6.1.2.1.25.3.2.1.2",
    "hrDeviceDescr": "1.3.6.1.2.1.25.3.2.1.3",
    "hrPrinterStatus": "1.3.6.1.2.1.25.3.5.1.1",
    "hrPrinterDetectedErrorState": "1.3.6.1.2.1.25.3.5.1.2",
    "ifPhysAddress": "1.3.6.1.2.1.2.2.1.6",
    "prtGeneralPrinterName": "1.3.6.1.2.1.43.5.1.1.16.1",
    "prtGeneralSerialNumber": "1.3.6.1.2.1.43.5.1.1.17.1",
    "prtMarkerLifeCount": "1.3.6.1.2.1.43.10.2.1.4.1.1",
    "prtMarkerTechnology": "1.3.6.1.2.1.43.10.2.1.2.1.1",
    "prtMarkerColorantValue": "1.3.6.1.2.1.43.12.1.1.4.1",
    "prtMarkerSuppliesColorantIndex": "1.3.6.1.2.1.43.11.1.1.3.1",
    "prtMarkerSuppliesClass": "1.3.6.1.2.1.43.11.1.1.4.1",
    "prtMarkerSuppliesType": "1.3.6.1.2.1.43.11.1.1.5.1",
    "prtMarkerSuppliesDescription": "1.3.6.1.2.1.43.11.1.1.6.1",
    "prtMarkerSuppliesSupplyUnit": "1.3.6.1.2.1.43.11.1.1.7.1",
    "prtMarkerSuppliesMaxCapacity": "1.3.6.1.2.1.43.11.1.1.8.1",
    "prtMarkerSuppliesLevel": "1.3.6.1.2.1.43.11.1.1.9.1",
    "prtAlertSeverityLevel": "1.3.6.1.2.1.43.18.1.1.2.1",
    "prtAlertGroup": "1.3.6.1.2.1.43.18.1.1.4.1",
    "prtAlertCode": "1.3.6.1.2.1.43.18.1.1.7.1",
    "prtAlertDescription": "1.3.6.1.2.1.43.18.1.1.8.1",
}

HR_DEVICE_PRINTER = (1, 3, 6, 1, 2, 1, 25, 3, 1, 5)

ENTERPRISES = {
    11: "HP", 253: "XEROX", 297: "XEROX", 641: "LEXMARK", 1347: "KYOCERA", 2435: "BROTHER",
    367: "RICOH", 1602: "CANON", 18334: "KONICA-MINOLTA", 1129: "TOSHIBA", 2385: "SHARP",
    1248: "EPSON", 236: "SAMSUNG", 2001: "OKI", 674: "DELL", 23978: "SOURCE",
    26696: "HP", 4322: "OLIVETTI", 3369: "KYOCERA", 3793: "RICOH",
}

SYSDESCR_VENDORS = [
    ("xerox", "XEROX"), ("hewlett", "HP"), ("laserjet", "HP"), ("hp ", "HP"), ("lexmark", "LEXMARK"),
    ("kyocera", "KYOCERA"), ("taskalfa", "KYOCERA"), ("ecosys", "KYOCERA"), ("brother", "BROTHER"),
    ("ricoh", "RICOH"), ("savin", "RICOH"), ("lanier", "RICOH"), ("canon", "CANON"),
    ("konica", "KONICA-MINOLTA"), ("bizhub", "KONICA-MINOLTA"), ("toshiba", "TOSHIBA"),
    ("e-studio", "TOSHIBA"), ("sharp", "SHARP"), ("epson", "EPSON"), ("samsung", "SAMSUNG"),
    ("oki", "OKI"), ("dell", "DELL"), ("zebra", "ZEBRA"),
]

SUPPLY_TYPES = {
    1: "other", 2: "unknown", 3: "toner", 4: "waste_toner", 5: "ink", 6: "ink", 7: "ribbon",
    8: "waste_ink", 9: "drum", 10: "developer", 11: "fuser_oil", 12: "wax", 13: "wax", 14: "waste_wax",
    15: "fuser", 16: "corona", 17: "fuser_wick", 18: "cleaner", 19: "fuser_pad", 20: "transfer",
    21: "toner", 22: "fuser_oiler", 23: "water", 24: "waste_water", 26: "waste_paper", 32: "staples",
}

MARKER_TECH = {
    1: "Other", 2: "Unknown", 3: "Laser", 4: "Laser", 5: "Laser", 6: "InkJet", 7: "InkJet",
    8: "InkJet", 9: "Dot Matrix", 10: "Dot Matrix", 11: "Thermal", 12: "Thermal", 13: "Thermal",
    14: "Thermal", 15: "Thermal", 16: "Laser", 17: "Laser", 18: "Thermal", 19: "Laser",
    20: "InkJet", 21: "Laser", 22: "InkJet", 23: "Laser", 24: "InkJet", 25: "InkJet",
    26: "Laser", 27: "Laser",
}

PRINTER_STATUS = {1: "other", 2: "unknown", 3: "idle", 4: "printing", 5: "warmup"}

# hrPrinterDetectedErrorState bit positions (bit 0 = MSB of first octet)
ERROR_BITS = [
    "low_paper", "no_paper", "low_toner", "no_toner", "door_open", "jammed", "offline",
    "service_requested", "input_tray_missing", "output_tray_missing", "marker_supply_missing",
    "output_near_full", "output_full", "input_tray_empty", "overdue_prevent_maint",
]

ALERT_SEVERITY = {1: "other", 3: "critical", 4: "warning", 5: "warning"}

COLOR_WORDS = ["black", "cyan", "magenta", "yellow", "light cyan", "light magenta", "gray", "grey",
               "photo black", "matte black"]

# Vendor counter profiles: OIDs for mono / colour / total impressions.
# These are best-effort and are only trusted when they reconcile with the
# standard prtMarkerLifeCount (see reconcile_counters). Override or extend per
# model in dca.json -> "counter_profiles".
COUNTER_PROFILES: Dict[str, Dict[str, Any]] = {
    "HP": {
        "total": "1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2.5.0",
        "mono": "1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2.6.0",
        "color": "1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2.7.0",
    },
    "XEROX": {
        "total": "1.3.6.1.4.1.253.8.53.13.2.1.6.1.20.1",
        "color": "1.3.6.1.4.1.253.8.53.13.2.1.6.1.20.33",
        "mono": "1.3.6.1.4.1.253.8.53.13.2.1.6.1.20.34",
    },
    "RICOH": {
        # Ricoh exposes a named counter table: names at .5, values at .9
        "table_names": "1.3.6.1.4.1.367.3.2.1.2.19.5.1.5",
        "table_values": "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9",
        "match": {"total": r"^total", "mono": r"black|b&w|mono", "color": r"full ?colou?r|colou?r"},
    },
    "KYOCERA": {
        "mono": "1.3.6.1.4.1.1347.42.3.1.1.1.1.1",
        "color": "1.3.6.1.4.1.1347.42.3.1.1.1.1.3",
        "total": "1.3.6.1.4.1.1347.43.10.1.1.12.1.1",
    },
    "LEXMARK": {
        "mono": "1.3.6.1.4.1.641.6.4.2.1.1.4.1.5",
        "color": "1.3.6.1.4.1.641.6.4.2.1.1.4.1.4",
    },
    "BROTHER": {
        "total": "1.3.6.1.4.1.2435.2.3.9.4.2.1.5.5.52.21.2.1",
    },
    "CANON": {
        "total": "1.3.6.1.4.1.1602.1.11.1.3.1.4.101",
        "mono": "1.3.6.1.4.1.1602.1.11.1.3.1.4.112",
        "color": "1.3.6.1.4.1.1602.1.11.1.3.1.4.122",
    },
    "KONICA-MINOLTA": {
        "mono": "1.3.6.1.4.1.18334.1.1.1.5.7.2.2.1.5.1.2",
        "color": "1.3.6.1.4.1.18334.1.1.1.5.7.2.2.1.5.2.2",
    },
    "TOSHIBA": {
        "mono": "1.3.6.1.4.1.1129.2.3.50.1.3.21.6.1.2.1.1",
        "color": "1.3.6.1.4.1.1129.2.3.50.1.3.21.6.1.2.1.2",
    },
    "SHARP": {
        "mono": "1.3.6.1.4.1.2385.1.1.19.2.1.3.5.4.60",
        "color": "1.3.6.1.4.1.2385.1.1.19.2.1.3.5.4.61",
    },
}


def to_text(value: Any) -> Optional[str]:
    if value is None or isinstance(value, NoSuch):
        return None
    if isinstance(value, bytes):
        txt = value.split(b"\x00", 1)[0].decode("utf-8", errors="replace").strip()
        return re.sub(r"[\x00-\x1f\x7f]", "", txt) or None
    if isinstance(value, tuple):
        return oid_to_str(value)
    return str(value).strip() or None


def to_int(value: Any) -> Optional[int]:
    if value is None or isinstance(value, NoSuch):
        return None
    if isinstance(value, int):
        return value
    try:
        return int(to_text(value) or "")
    except ValueError:
        return None


def mac_from_bytes(value: Any) -> Optional[str]:
    if isinstance(value, bytes) and len(value) == 6 and any(value):
        return ":".join(f"{b:02X}" for b in value)
    return None


def vendor_from(sys_object_id: Any, sys_descr: Optional[str], model: Optional[str]) -> Optional[str]:
    if isinstance(sys_object_id, tuple) and sys_object_id[:6] == (1, 3, 6, 1, 4, 1) and len(sys_object_id) > 6:
        v = ENTERPRISES.get(sys_object_id[6])
        if v:
            return v
    hay = f" {(sys_descr or '')} {(model or '')} ".lower()
    for needle, vendor in SYSDESCR_VENDORS:
        if needle in hay:
            return vendor
    return None


def decode_error_state(value: Any) -> List[str]:
    if not isinstance(value, bytes):
        return []
    flags = []
    for i, name in enumerate(ERROR_BITS):
        byte_i, bit = divmod(i, 8)
        if byte_i < len(value) and value[byte_i] & (0x80 >> bit):
            flags.append(name)
    return flags


def guess_color(desc: str, colorant: Optional[str]) -> Optional[str]:
    hay = f"{colorant or ''} {desc}".lower()
    for word in sorted(COLOR_WORDS, key=len, reverse=True):
        if word in hay:
            return "black" if "black" in word else word.replace("grey", "gray")
    for code, name in (("(k)", "black"), ("(c)", "cyan"), ("(m)", "magenta"), ("(y)", "yellow")):
        if code in hay:
            return name
    return None


def supply_level_pct(level: Optional[int], max_cap: Optional[int]) -> Optional[float]:
    """Printer-MIB: level -1 other, -2 unknown, -3 'some remaining' (treated as OK/unknown)."""
    if level is None or level < 0:
        return None
    if max_cap is None or max_cap <= 0:
        # Many devices report a straight percentage with max -2 (unknown)
        return float(level) if 0 <= level <= 100 else None
    return round(max(0.0, min(100.0, level * 100.0 / max_cap)), 1)


def reconcile_counters(total: Optional[int], mono: Optional[int], color: Optional[int],
                       is_color: bool) -> Tuple[Optional[int], Optional[int], Optional[int], str]:
    """Sanity-check vendor counters against the standard life count.

    Returns (total, mono, color, quality) where quality is one of
    'vendor', 'derived', 'total_only'.
    """
    if mono is not None and mono < 0:
        mono = None
    if color is not None and color < 0:
        color = None
    if mono is not None and color is not None:
        s = mono + color
        if total is None or total == 0 or abs(s - total) <= max(50, total * 0.05) or s <= total:
            return (total if total else s), mono, color, "vendor"
    if not is_color and total is not None:
        return total, total, 0, "derived"
    if total is not None and mono is not None and 0 <= mono <= total:
        return total, mono, total - mono, "derived"
    if total is not None and color is not None and 0 <= color <= total:
        return total, total - color, color, "derived"
    return total, None, None, "total_only"


# =============================================================================
# Collection
# =============================================================================

def quick_probe(ip: str, communities: List[str], version: str, timeout: float, retries: int,
                port: int = 161) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Cheap check: is there an SNMP printer at this address? Returns (community, values)."""
    oids = [OID["sysDescr"], OID["sysObjectID"], OID["prtGeneralSerialNumber"], OID["prtMarkerLifeCount"]]
    for community in communities:
        client = SnmpClient(ip, community, version, port=port, timeout=timeout, retries=retries)
        try:
            vals = client.get(oids)
        except SnmpError:
            continue
        descr = to_text(vals.get(OID["sysDescr"])) or ""
        is_printer = (vals.get(OID["prtMarkerLifeCount"]) is not None
                      or vals.get(OID["prtGeneralSerialNumber"]) is not None
                      or re.search(r"print|laserjet|mfp|copier|workcentre|versalink|altalink|bizhub|taskalfa|ecosys",
                                   descr, re.I) is not None)
        if is_printer:
            return community, vals
        return None  # SNMP device but not a printer
    return None


def collect_device(ip: str, community: str, version: str = "2c", timeout: float = 2.0,
                   retries: int = 1, port: int = 161,
                   profiles: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Full collection for a single printer."""
    c = SnmpClient(ip, community, version, port=port, timeout=timeout, retries=retries)
    base = c.get([OID["sysDescr"], OID["sysObjectID"], OID["sysName"], OID["sysLocation"],
                  OID["sysContact"], OID["sysUpTime"], OID["prtGeneralSerialNumber"],
                  OID["prtGeneralPrinterName"], OID["prtMarkerLifeCount"], OID["prtMarkerTechnology"]])

    # Locate the printer row in hrDeviceTable
    hr_index = None
    model = None
    try:
        types = c.walk(OID["hrDeviceType"], max_rows=64)
        for oid, val in types:
            if isinstance(val, tuple) and val == HR_DEVICE_PRINTER:
                hr_index = oid[-1]
                break
    except SnmpError:
        types = []
    status = None
    errors: List[str] = []
    if hr_index is not None:
        hr = c.get([f"{OID['hrDeviceDescr']}.{hr_index}", f"{OID['hrPrinterStatus']}.{hr_index}",
                    f"{OID['hrPrinterDetectedErrorState']}.{hr_index}"])
        model = to_text(hr.get(f"{OID['hrDeviceDescr']}.{hr_index}"))
        status = PRINTER_STATUS.get(to_int(hr.get(f"{OID['hrPrinterStatus']}.{hr_index}")) or 0)
        errors = decode_error_state(hr.get(f"{OID['hrPrinterDetectedErrorState']}.{hr_index}"))
    sys_descr = to_text(base.get(OID["sysDescr"]))
    model = model or to_text(base.get(OID["prtGeneralPrinterName"])) or sys_descr
    manufacturer = vendor_from(base.get(OID["sysObjectID"]), sys_descr, model)
    if model and manufacturer:
        # strip duplicated vendor prefix e.g. "Xerox Xerox VersaLink"
        model = re.sub(r"^(%s\s+)+" % re.escape(manufacturer.split("-")[0]), "", model, flags=re.I).strip() or model

    # MAC
    mac = None
    try:
        for _oid, val in c.walk(OID["ifPhysAddress"], max_rows=16):
            mac = mac_from_bytes(val)
            if mac:
                break
    except SnmpError:
        pass

    # Colorants
    colorants: Dict[int, str] = {}
    try:
        for oid, val in c.walk(OID["prtMarkerColorantValue"], max_rows=32):
            colorants[oid[-1]] = (to_text(val) or "").lower()
    except SnmpError:
        pass

    # Supplies table
    def column(name: str) -> Dict[int, Any]:
        try:
            return {oid[-1]: val for oid, val in c.walk(OID[name], max_rows=64)}
        except SnmpError:
            return {}

    descs = column("prtMarkerSuppliesDescription")
    supplies = []
    if descs:
        types_ = column("prtMarkerSuppliesType")
        classes = column("prtMarkerSuppliesClass")
        maxes = column("prtMarkerSuppliesMaxCapacity")
        levels = column("prtMarkerSuppliesLevel")
        units = column("prtMarkerSuppliesSupplyUnit")
        cidx = column("prtMarkerSuppliesColorantIndex")
        for idx in sorted(descs):
            desc = to_text(descs[idx]) or f"Supply {idx}"
            stype = SUPPLY_TYPES.get(to_int(types_.get(idx)) or 2, "other")
            level = to_int(levels.get(idx))
            max_cap = to_int(maxes.get(idx))
            colorant = colorants.get(to_int(cidx.get(idx)) or 0)
            supplies.append({
                "index": idx,
                "name": desc,
                "type": stype,
                "class": "receptacle" if to_int(classes.get(idx)) == 4 else "consumed",
                "color": guess_color(desc, colorant) if stype in ("toner", "ink", "drum", "developer") else None,
                "level_raw": level,
                "max_capacity": max_cap,
                "unit": to_int(units.get(idx)),
                "level_pct": supply_level_pct(level, max_cap),
                "some_remaining": level == -3,
            })

    # Device alerts (Printer-MIB alert table)
    alerts = []
    try:
        adesc = {oid[-1]: to_text(v) for oid, v in c.walk(OID["prtAlertDescription"], max_rows=32)}
        if adesc:
            acode = {oid[-1]: to_int(v) for oid, v in c.walk(OID["prtAlertCode"], max_rows=32)}
            asev = {oid[-1]: to_int(v) for oid, v in c.walk(OID["prtAlertSeverityLevel"], max_rows=32)}
            for idx, desc in adesc.items():
                alerts.append({"index": idx, "code": acode.get(idx), "description": desc,
                               "severity": ALERT_SEVERITY.get(asev.get(idx) or 1, "other")})
    except SnmpError:
        pass

    marker_colors = {s["color"] for s in supplies if s["color"] and s["type"] in ("toner", "ink")}
    is_color = bool(marker_colors - {"black"}) or len([v for v in colorants.values() if v and v != "black"]) > 0

    # Counters
    total = to_int(base.get(OID["prtMarkerLifeCount"]))
    mono = color = None
    profile = (profiles or COUNTER_PROFILES).get(manufacturer or "", {})
    vendor_total = None
    if profile:
        try:
            if "table_names" in profile:
                names = {oid[-1]: (to_text(v) or "").lower() for oid, v in c.walk(profile["table_names"], 64)}
                values = {oid[-1]: to_int(v) for oid, v in c.walk(profile["table_values"], 64)}
                for key, pattern in profile.get("match", {}).items():
                    for idx, nm in names.items():
                        if re.search(pattern, nm) and values.get(idx) is not None:
                            if key == "total":
                                vendor_total = values[idx]
                            elif key == "mono":
                                mono = values[idx]
                            else:
                                color = values[idx]
                            break
            else:
                want = [profile[k] for k in ("total", "mono", "color") if k in profile]
                vals = c.get(want)
                vendor_total = to_int(vals.get(profile.get("total", "").strip("."))) if "total" in profile else None
                mono = to_int(vals.get(profile.get("mono", "").strip("."))) if "mono" in profile else None
                color = to_int(vals.get(profile.get("color", "").strip("."))) if "color" in profile else None
        except SnmpError:
            pass
    if total is None:
        total = vendor_total
    total, mono, color, quality = reconcile_counters(total, mono, color, is_color)

    tech = MARKER_TECH.get(to_int(base.get(OID["prtMarkerTechnology"])) or 2, "Unknown")
    serial = to_text(base.get(OID["prtGeneralSerialNumber"]))
    return {
        "ip": ip,
        "serial": serial or (f"MAC-{mac.replace(':', '')}" if mac else f"IP-{ip}"),
        "serial_reported": bool(serial),
        "manufacturer": manufacturer,
        "model": model,
        "host_name": to_text(base.get(OID["sysName"])),
        "location": to_text(base.get(OID["sysLocation"])),
        "contact": to_text(base.get(OID["sysContact"])),
        "sys_descr": sys_descr,
        "uptime_s": (to_int(base.get(OID["sysUpTime"])) or 0) // 100,
        "mac": mac,
        "technology": tech,
        "is_color": is_color,
        "status": status,
        "errors": errors,
        "meters": {"total": total, "mono": mono, "color": color, "quality": quality},
        "supplies": supplies,
        "alerts": alerts,
        "collected_at": utcnow(),
    }


# =============================================================================
# Discovery
# =============================================================================

def expand_targets(ranges: Iterable[str], exclude: Iterable[str] = (), limit: int = 65536) -> List[str]:
    """Accepts CIDR (10.0.0.0/24), dash ranges (10.0.0.10-10.0.0.60 or 10.0.0.10-60) and single IPs."""
    out: List[str] = []
    seen = set()
    excl = set()
    for e in exclude:
        excl.update(expand_targets([e], (), limit))
    for r in ranges:
        r = r.strip()
        if not r:
            continue
        try:
            if "/" in r:
                net = ipaddress.ip_network(r, strict=False)
                hosts = [str(h) for h in (net.hosts() if net.num_addresses > 2 else net)]
            elif "-" in r:
                a, b = r.split("-", 1)
                start = ipaddress.ip_address(a.strip())
                b = b.strip()
                if "." not in b:
                    b = ".".join(a.strip().split(".")[:3] + [b])
                end = ipaddress.ip_address(b)
                hosts = [str(ipaddress.ip_address(i)) for i in range(int(start), int(end) + 1)]
            else:
                hosts = [str(ipaddress.ip_address(r))]
        except ValueError:
            # allow hostnames
            hosts = [r]
        for h in hosts:
            if h not in seen and h not in excl:
                seen.add(h)
                out.append(h)
                if len(out) >= limit:
                    return out
    return out


def local_subnets() -> List[str]:
    """Best-effort guess of the local /24 when no ranges are configured."""
    nets = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        if not ip.startswith("127."):
            nets.add(str(ipaddress.ip_network(ip + "/24", strict=False)))
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and not ip.startswith("169.254."):
                nets.add(str(ipaddress.ip_network(ip + "/24", strict=False)))
    except OSError:
        pass
    return sorted(nets)


def discover(targets: List[str], communities: List[str], version: str, timeout: float, retries: int,
             workers: int, port: int = 161) -> List[Tuple[str, str]]:
    found: List[Tuple[str, str]] = []
    lock = threading.Lock()

    def probe(ip: str):
        res = quick_probe(ip, communities, version, timeout, retries, port)
        if res:
            with lock:
                found.append((ip, res[0]))

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        list(pool.map(probe, targets))
    found.sort(key=lambda x: tuple(int(p) if p.isdigit() else 0 for p in x[0].split(".")))
    return found


# =============================================================================
# Agent (config, upload, spool, remote commands)
# =============================================================================

DEFAULT_CONFIG: Dict[str, Any] = {
    "endpoint": "",                 # https://<project>.supabase.co/functions/v1/dca-ingest
    "key": "",                      # DCA key shown once when the install was created
    "site_name": "",
    "ranges": [],                   # empty => auto-detect local /24
    "exclude": [],
    "communities": ["public"],
    "snmp_version": "2c",
    "snmp_port": 161,
    "timeout": 1.5,
    "retries": 1,
    "workers": 64,
    "interval_minutes": 240,
    "full_rescan_hours": 24,        # between cycles, only known printers are re-polled
    "spool_dir": "",
    "log_file": "",
    "log_level": "INFO",
    "verify_tls": True,
    "proxy": "",                    # optional outbound HTTPS proxy
    "counter_profiles": {},         # override/extend COUNTER_PROFILES
}


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def default_data_dir() -> Path:
    if os.name == "nt":
        return Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "UrFleet" / "DCA"
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        return Path("/var/lib/urfleet-dca")
    return Path.home() / ".urfleet-dca"


def load_config(path: Optional[str]) -> Dict[str, Any]:
    cfg = dict(DEFAULT_CONFIG)
    if path and Path(path).exists():
        with open(path, "r", encoding="utf-8") as fh:
            cfg.update(json.load(fh))
    # environment overrides (handy for containers)
    for k in ("endpoint", "key"):
        env = os.environ.get(f"URFLEET_DCA_{k.upper()}")
        if env:
            cfg[k] = env
    data = default_data_dir()
    cfg["spool_dir"] = cfg.get("spool_dir") or str(data / "spool")
    cfg["log_file"] = cfg.get("log_file") or str(data / "dca.log")
    return cfg


def setup_logging(cfg: Dict[str, Any], verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else getattr(logging, str(cfg.get("log_level", "INFO")).upper(), logging.INFO)
    root = logging.getLogger("urfleet")
    root.setLevel(level)
    root.handlers.clear()
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    sh = logging.StreamHandler(sys.stderr)
    sh.setFormatter(fmt)
    root.addHandler(sh)
    try:
        Path(cfg["log_file"]).parent.mkdir(parents=True, exist_ok=True)
        fh = logging.handlers.RotatingFileHandler(cfg["log_file"], maxBytes=2_000_000, backupCount=3)
        fh.setFormatter(fmt)
        root.addHandler(fh)
    except OSError:
        pass


class Agent:
    def __init__(self, cfg: Dict[str, Any], config_path: Optional[str] = None):
        self.cfg = cfg
        self.config_path = config_path
        self.known: List[Tuple[str, str]] = []   # (ip, community) discovered printers
        self.last_full_scan = 0.0
        self.command_results: List[Dict[str, Any]] = []
        self.force_rescan = False
        self.spool = Path(cfg["spool_dir"])
        self.state_file = self.spool.parent / "state.json"
        self._load_state()

    # ---- state -------------------------------------------------------------
    def _load_state(self) -> None:
        try:
            st = json.loads(self.state_file.read_text())
            self.known = [tuple(x) for x in st.get("known", [])]
            self.last_full_scan = float(st.get("last_full_scan", 0))
        except (OSError, ValueError):
            pass

    def _save_state(self) -> None:
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            self.state_file.write_text(json.dumps({"known": self.known, "last_full_scan": self.last_full_scan}))
        except OSError as exc:
            log.warning("could not save state: %s", exc)

    # ---- collection --------------------------------------------------------
    def profiles(self) -> Dict[str, Dict[str, Any]]:
        p = dict(COUNTER_PROFILES)
        p.update(self.cfg.get("counter_profiles") or {})
        return p

    def targets(self) -> List[str]:
        ranges = self.cfg.get("ranges") or local_subnets()
        return expand_targets(ranges, self.cfg.get("exclude") or [])

    def cycle(self) -> Dict[str, Any]:
        cfg = self.cfg
        started = time.time()
        full = (self.force_rescan or not self.known
                or started - self.last_full_scan > float(cfg["full_rescan_hours"]) * 3600)
        if full:
            targets = self.targets()
            log.info("discovery: scanning %d addresses", len(targets))
            self.known = discover(targets, cfg["communities"], cfg["snmp_version"], float(cfg["timeout"]),
                                  int(cfg["retries"]), int(cfg["workers"]), int(cfg["snmp_port"]))
            self.last_full_scan = started
            self.force_rescan = False
            log.info("discovery: %d printers found", len(self.known))
        devices, errors = [], []

        def run(item):
            ip, community = item
            try:
                return collect_device(ip, community, cfg["snmp_version"], max(float(cfg["timeout"]), 2.0),
                                      int(cfg["retries"]), int(cfg["snmp_port"]), self.profiles())
            except SnmpError as exc:
                errors.append({"ip": ip, "error": str(exc)})
                return None

        with ThreadPoolExecutor(max_workers=min(16, max(1, len(self.known)))) as pool:
            for dev in pool.map(run, self.known):
                if dev:
                    devices.append(dev)
        self._save_state()
        payload = {
            "agent": {
                "name": AGENT_NAME, "version": __version__, "host_name": socket.gethostname(),
                "os": f"{platform.system()} {platform.release()}", "python": platform.python_version(),
                "site_name": cfg.get("site_name") or None,
            },
            "scan": {
                "started_at": datetime.fromtimestamp(started, timezone.utc).replace(microsecond=0).isoformat(),
                "duration_s": round(time.time() - started, 1), "full_discovery": full,
                "ranges": cfg.get("ranges") or local_subnets(), "printers_found": len(self.known),
                "errors": errors[:50],
            },
            "devices": devices,
            "command_results": self.command_results,
        }
        self.command_results = []
        return payload

    # ---- transport ---------------------------------------------------------
    def _post(self, body: Dict[str, Any]) -> Dict[str, Any]:
        data = json.dumps(body, default=str).encode("utf-8")
        req = urllib.request.Request(self.cfg["endpoint"], data=data, method="POST", headers={
            "Content-Type": "application/json",
            "x-dca-key": self.cfg["key"],
            "User-Agent": f"{AGENT_NAME}/{__version__}",
        })
        handlers = []
        if self.cfg.get("proxy"):
            handlers.append(urllib.request.ProxyHandler({"https": self.cfg["proxy"], "http": self.cfg["proxy"]}))
        if not self.cfg.get("verify_tls", True):
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            handlers.append(urllib.request.HTTPSHandler(context=ctx))
        opener = urllib.request.build_opener(*handlers)
        with opener.open(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8") or "{}"
            return json.loads(raw)

    def _spool_write(self, payload: Dict[str, Any]) -> None:
        self.spool.mkdir(parents=True, exist_ok=True)
        files = sorted(self.spool.glob("pending-*.json"))
        for old in files[: max(0, len(files) - 499)]:
            old.unlink(missing_ok=True)
        name = self.spool / f"pending-{int(time.time() * 1000)}.json"
        name.write_text(json.dumps(payload, default=str))
        log.warning("cloud unreachable — payload spooled to %s", name)

    def flush_spool(self, max_files: int = 20) -> int:
        if not self.spool.exists():
            return 0
        sent = 0
        for f in sorted(self.spool.glob("pending-*.json"))[:max_files]:
            try:
                body = json.loads(f.read_text())
            except (OSError, ValueError):
                f.unlink(missing_ok=True)
                continue
            body["replayed"] = True
            try:
                self._post(body)
            except (urllib.error.URLError, OSError, ValueError) as exc:
                log.info("spool replay paused: %s", exc)
                break
            f.unlink(missing_ok=True)
            sent += 1
        return sent

    def upload(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self.cfg.get("endpoint") or not self.cfg.get("key"):
            log.error("endpoint/key not configured — run `init` first")
            self._spool_write(payload)
            return None
        try:
            resp = self._post(payload)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            log.error("ingest rejected payload: HTTP %s %s", exc.code, detail)
            if exc.code >= 500 or exc.code == 429:
                self._spool_write(payload)
            return None
        except (urllib.error.URLError, OSError, ValueError) as exc:
            log.error("upload failed: %s", exc)
            self._spool_write(payload)
            return None
        replayed = self.flush_spool()
        log.info("uploaded %d devices%s", len(payload["devices"]), f" (+{replayed} spooled)" if replayed else "")
        self.apply_response(resp)
        return resp

    # ---- remote config / commands -----------------------------------------
    def apply_response(self, resp: Dict[str, Any]) -> None:
        remote = resp.get("config") or {}
        changed = False
        for key in ("ranges", "exclude", "communities", "snmp_version", "interval_minutes", "timeout",
                    "retries", "workers", "full_rescan_hours", "counter_profiles", "log_level"):
            if key in remote and remote[key] not in (None, "") and remote[key] != self.cfg.get(key):
                if key in ("ranges", "communities") and not remote[key]:
                    continue
                self.cfg[key] = remote[key]
                changed = True
                if key in ("ranges", "exclude", "communities", "snmp_version"):
                    self.force_rescan = True
        if changed:
            log.info("remote configuration applied (config_version=%s)", remote.get("config_version"))
            self._persist_config()
        for cmd in resp.get("commands") or []:
            self.run_command(cmd)

    def _persist_config(self) -> None:
        if not self.config_path:
            return
        try:
            keep = {k: v for k, v in self.cfg.items() if k in DEFAULT_CONFIG}
            Path(self.config_path).write_text(json.dumps(keep, indent=2))
        except OSError as exc:
            log.warning("could not persist config: %s", exc)

    def run_command(self, cmd: Dict[str, Any]) -> None:
        name = cmd.get("command")
        args = cmd.get("args") or {}
        result: Dict[str, Any] = {"id": cmd.get("id"), "command": name, "ok": True, "at": utcnow()}
        try:
            if name == "rescan":
                self.force_rescan = True
                result["detail"] = "full discovery queued for next cycle"
            elif name == "collect_now":
                self.force_rescan = bool(args.get("rescan"))
                self._collect_now = True
                result["detail"] = "collection triggered"
            elif name == "ping":
                result["detail"] = {"version": __version__, "known_printers": len(self.known), "time": utcnow()}
            elif name == "set_log_level":
                logging.getLogger("urfleet").setLevel(getattr(logging, str(args.get("level", "INFO")).upper()))
            elif name == "update_config":
                self.apply_response({"config": args})
            else:
                result.update(ok=False, detail=f"unknown command {name}")
        except Exception as exc:  # pragma: no cover - defensive
            result.update(ok=False, detail=str(exc))
        self.command_results.append(result)

    def run_forever(self) -> None:
        log.info("%s %s starting (interval %s min)", AGENT_NAME, __version__, self.cfg["interval_minutes"])
        self._collect_now = False
        while True:
            try:
                payload = self.cycle()
                self.upload(payload)
            except Exception:  # never die in service mode
                log.exception("cycle failed")
            interval = max(5, int(self.cfg.get("interval_minutes") or 240)) * 60
            waited = 0
            while waited < interval and not getattr(self, "_collect_now", False):
                time.sleep(5)
                waited += 5
            self._collect_now = False


# =============================================================================
# CLI
# =============================================================================

def _print(obj: Any) -> None:
    print(json.dumps(obj, indent=2, default=str))


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="urfleet-dca", description="UrFleet Data Collection Agent")
    ap.add_argument("-c", "--config", default=os.environ.get("URFLEET_DCA_CONFIG") or str(default_data_dir() / "dca.json"))
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("run", help="run continuously (service mode)")
    sub.add_parser("once", help="one discovery + collection + upload cycle")
    p_scan = sub.add_parser("scan", help="discover printers on a range (no upload)")
    p_scan.add_argument("--range", action="append", default=[])
    p_scan.add_argument("--community", action="append", default=[])
    p_scan.add_argument("--port", type=int, default=161)
    p_scan.add_argument("--json", action="store_true", help="full collection as JSON")
    p_probe = sub.add_parser("probe", help="full collection for one device")
    p_probe.add_argument("--ip", required=True)
    p_probe.add_argument("--community", default="public")
    p_probe.add_argument("--port", type=int, default=161)
    p_probe.add_argument("--snmp-version", default="2c")
    p_walk = sub.add_parser("walk", help="SNMP walk for diagnostics")
    p_walk.add_argument("--ip", required=True)
    p_walk.add_argument("--oid", default="1.3.6.1.2.1.43")
    p_walk.add_argument("--community", default="public")
    p_walk.add_argument("--port", type=int, default=161)
    p_init = sub.add_parser("init", help="write a config file")
    p_init.add_argument("--endpoint", required=True)
    p_init.add_argument("--key", required=True)
    p_init.add_argument("--range", action="append", default=[])
    p_init.add_argument("--community", action="append", default=[])
    p_init.add_argument("--site-name", default="")
    p_dry = sub.add_parser("dry-run", help="collect and write payload to a file instead of uploading")
    p_dry.add_argument("--out", default="payload.json")
    sub.add_parser("version")
    args = ap.parse_args(argv)

    if args.cmd in (None, "version"):
        print(f"{AGENT_NAME} {__version__}")
        return 0

    cfg = load_config(args.config)
    setup_logging(cfg, args.verbose)

    if args.cmd == "init":
        cfg.update(endpoint=args.endpoint, key=args.key, site_name=args.site_name)
        if args.range:
            cfg["ranges"] = args.range
        if args.community:
            cfg["communities"] = args.community
        Path(args.config).parent.mkdir(parents=True, exist_ok=True)
        keep = {k: v for k, v in cfg.items() if k in DEFAULT_CONFIG}
        Path(args.config).write_text(json.dumps(keep, indent=2))
        try:
            os.chmod(args.config, 0o600)
        except OSError:
            pass
        print(f"config written to {args.config}")
        return 0

    if args.cmd == "scan":
        ranges = args.range or cfg.get("ranges") or local_subnets()
        comms = args.community or cfg["communities"]
        targets = expand_targets(ranges, cfg.get("exclude") or [])
        print(f"scanning {len(targets)} addresses in {', '.join(ranges)} ...", file=sys.stderr)
        found = discover(targets, comms, cfg["snmp_version"], float(cfg["timeout"]), int(cfg["retries"]),
                         int(cfg["workers"]), args.port)
        if args.json:
            _print([collect_device(ip, cm, cfg["snmp_version"], port=args.port) for ip, cm in found])
        else:
            for ip, cm in found:
                d = collect_device(ip, cm, cfg["snmp_version"], port=args.port)
                print(f"{ip:15}  {d['manufacturer'] or '?':14} {d['model'] or '?':40.40} SN {d['serial']:18} "
                      f"total {d['meters']['total']}")
            print(f"{len(found)} printer(s) found", file=sys.stderr)
        return 0

    if args.cmd == "probe":
        _print(collect_device(args.ip, args.community, args.snmp_version, port=args.port))
        return 0

    if args.cmd == "walk":
        client = SnmpClient(args.ip, args.community, cfg["snmp_version"], port=args.port, timeout=2)
        for oid, val in client.walk(args.oid, max_rows=5000):
            shown = to_text(val) if isinstance(val, bytes) else (oid_to_str(val) if isinstance(val, tuple) else val)
            print(f"{oid_to_str(oid)} = {shown}")
        return 0

    agent = Agent(cfg, args.config)
    if args.cmd == "dry-run":
        payload = agent.cycle()
        Path(args.out).write_text(json.dumps(payload, indent=2, default=str))
        print(f"{len(payload['devices'])} devices written to {args.out}")
        return 0
    if args.cmd == "once":
        payload = agent.cycle()
        return 0 if agent.upload(payload) is not None else 2
    if args.cmd == "run":
        agent.run_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
