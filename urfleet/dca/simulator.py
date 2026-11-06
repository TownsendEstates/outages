#!/usr/bin/env python3
"""
SNMP printer simulator for testing the UrFleet DCA without real hardware.

    python simulator.py --port 16100              # one simulated Xerox colour MFP
    python simulator.py --port 16100 --profile hp_mono

Then:  python urfleet_dca.py probe --ip 127.0.0.1 --port 16100
"""
from __future__ import annotations

import argparse
import socket
import threading
from typing import Any, Dict, List, Tuple

import urfleet_dca as d


def xerox_color(serial: str = "4AV775587", total: int = 182_400, color: int = 121_300,
                black_level: int = 2, ip_suffix: int = 79) -> Dict[str, Any]:
    mono = total - color
    oids: Dict[str, Any] = {
        "1.3.6.1.2.1.1.1.0": "Xerox Phaser 6510; SS 1.0, ESS 64.50.61",
        "1.3.6.1.2.1.1.2.0": ("oid", "1.3.6.1.4.1.253.8.62.1.25.2.1.1"),
        "1.3.6.1.2.1.1.3.0": ("timeticks", 8_640_000),
        "1.3.6.1.2.1.1.4.0": "it@butlerbyers.example",
        "1.3.6.1.2.1.1.5.0": "XRX-PHASER6510",
        "1.3.6.1.2.1.1.6.0": "Reception",
        "1.3.6.1.2.1.2.2.1.6.1": b"\x00\x00\xaa\x12\x34\x56",
        "1.3.6.1.2.1.25.3.2.1.2.1": ("oid", "1.3.6.1.2.1.25.3.1.5"),
        "1.3.6.1.2.1.25.3.2.1.3.1": "Xerox Phaser 6510",
        "1.3.6.1.2.1.25.3.5.1.1.1": 3,
        "1.3.6.1.2.1.25.3.5.1.2.1": b"\x20\x00",  # lowToner
        "1.3.6.1.2.1.43.5.1.1.16.1": "Phaser 6510",
        "1.3.6.1.2.1.43.5.1.1.17.1": serial,
        "1.3.6.1.2.1.43.10.2.1.2.1.1": 4,
        "1.3.6.1.2.1.43.10.2.1.4.1.1": ("counter32", total),
        "1.3.6.1.4.1.253.8.53.13.2.1.6.1.20.1": total,
        "1.3.6.1.4.1.253.8.53.13.2.1.6.1.20.33": color,
        "1.3.6.1.4.1.253.8.53.13.2.1.6.1.20.34": mono,
        "1.3.6.1.2.1.43.18.1.1.2.1.1": 4,
        "1.3.6.1.2.1.43.18.1.1.7.1.1": 1101,
        "1.3.6.1.2.1.43.18.1.1.8.1.1": "Black Toner Cartridge is low",
    }
    supplies = [
        ("Black Toner Cartridge; SN XRX106R03480", 3, 3, black_level, 100, 1),
        ("Cyan Toner Cartridge", 3, 3, 46, 100, 2),
        ("Magenta Toner Cartridge", 3, 3, 61, 100, 3),
        ("Yellow Toner Cartridge", 3, 3, 15, 100, 4),
        ("Imaging Unit", 9, 3, 72, 100, 0),
        ("Waste Cartridge", 4, 4, -3, -2, 0),
    ]
    colorants = {1: "black", 2: "cyan", 3: "magenta", 4: "yellow"}
    for idx, (desc, stype, scls, level, maxc, cidx) in enumerate(supplies, start=1):
        oids[f"1.3.6.1.2.1.43.11.1.1.3.1.{idx}"] = cidx
        oids[f"1.3.6.1.2.1.43.11.1.1.4.1.{idx}"] = scls
        oids[f"1.3.6.1.2.1.43.11.1.1.5.1.{idx}"] = stype
        oids[f"1.3.6.1.2.1.43.11.1.1.6.1.{idx}"] = desc
        oids[f"1.3.6.1.2.1.43.11.1.1.7.1.{idx}"] = 19
        oids[f"1.3.6.1.2.1.43.11.1.1.8.1.{idx}"] = maxc
        oids[f"1.3.6.1.2.1.43.11.1.1.9.1.{idx}"] = level
    for idx, name in colorants.items():
        oids[f"1.3.6.1.2.1.43.12.1.1.4.1.{idx}"] = name
    return oids


def hp_mono(serial: str = "VNB3K12345", total: int = 54_210) -> Dict[str, Any]:
    return {
        "1.3.6.1.2.1.1.1.0": "HP ETHERNET MULTI-ENVIRONMENT,ROM none,JETDIRECT,JD153",
        "1.3.6.1.2.1.1.2.0": ("oid", "1.3.6.1.4.1.11.2.3.9.1"),
        "1.3.6.1.2.1.1.5.0": "NPI8C1234",
        "1.3.6.1.2.1.25.3.2.1.2.1": ("oid", "1.3.6.1.2.1.25.3.1.5"),
        "1.3.6.1.2.1.25.3.2.1.3.1": "HP LaserJet Pro M404dn",
        "1.3.6.1.2.1.25.3.5.1.1.1": 3,
        "1.3.6.1.2.1.25.3.5.1.2.1": b"\x00",
        "1.3.6.1.2.1.43.5.1.1.17.1": serial,
        "1.3.6.1.2.1.43.10.2.1.4.1.1": ("counter32", total),
        "1.3.6.1.2.1.43.11.1.1.5.1.1": 3,
        "1.3.6.1.2.1.43.11.1.1.6.1.1": "Black Cartridge HP CF258A",
        "1.3.6.1.2.1.43.11.1.1.8.1.1": 3000,
        "1.3.6.1.2.1.43.11.1.1.9.1.1": 1260,
    }


PROFILES = {"xerox_color": xerox_color, "hp_mono": hp_mono}


class SnmpSimulator:
    """Minimal SNMP v1/v2c agent backed by a dict of OIDs. Thread-based, for tests."""

    def __init__(self, oids: Dict[str, Any], community: str = "public", host: str = "127.0.0.1", port: int = 0):
        self.community = community
        self.table: List[Tuple[Tuple[int, ...], Any]] = sorted(
            (d.oid_to_tuple(k), v) for k, v in oids.items())
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind((host, port))
        self.port = self.sock.getsockname()[1]
        self._stop = threading.Event()
        self.thread = threading.Thread(target=self._serve, daemon=True)

    def start(self) -> "SnmpSimulator":
        self.thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        self.sock.close()

    def _lookup(self, oid):
        for k, v in self.table:
            if k == oid:
                return v
        return d.NoSuch(d.TAG_NO_SUCH_INSTANCE)

    def _next(self, oid):
        for k, v in self.table:
            if k > oid:
                return k, v
        return oid, d.NoSuch(d.TAG_END_OF_MIB_VIEW)

    def _serve(self) -> None:
        self.sock.settimeout(0.2)
        while not self._stop.is_set():
            try:
                data, addr = self.sock.recvfrom(65535)
            except (socket.timeout, OSError):
                continue
            try:
                req = d.parse_message(data)
            except d.SnmpError:
                continue
            if req["community"] != self.community:
                continue  # wrong community => silence, like a real device
            out = []
            if req["pdu"] == d.PDU_GET:
                for oid, _t, _v in req["varbinds"]:
                    out.append((oid, self._lookup(oid)))
            elif req["pdu"] == d.PDU_GETNEXT:
                for oid, _t, _v in req["varbinds"]:
                    out.append(self._next(oid))
            elif req["pdu"] == d.PDU_GETBULK:
                reps = max(1, req["error_index"])
                for oid, _t, _v in req["varbinds"]:
                    cur = oid
                    for _ in range(reps):
                        nxt, val = self._next(cur)
                        out.append((nxt, val))
                        if isinstance(val, d.NoSuch):
                            break
                        cur = nxt
            err = 0
            if req["version"] == 0 and any(isinstance(v, d.NoSuch) for _o, v in out):
                err = 2  # v1 noSuchName
                idx = next(i for i, (_o, v) in enumerate(out, 1) if isinstance(v, d.NoSuch))
                resp = d.build_message(0, req["community"], d.PDU_RESPONSE, req["request_id"],
                                       [(o, d.ber_null()) for o, _t, _v in req["varbinds"]], err, idx)
            else:
                resp = d.build_message(req["version"], req["community"], d.PDU_RESPONSE, req["request_id"],
                                       [(o, d.encode_value(v)) for o, v in out])
            try:
                self.sock.sendto(resp, addr)
            except OSError:
                pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=16100)
    ap.add_argument("--profile", choices=sorted(PROFILES), default="xerox_color")
    ap.add_argument("--community", default="public")
    a = ap.parse_args()
    sim = SnmpSimulator(PROFILES[a.profile](), a.community, port=a.port).start()
    print(f"simulated {a.profile} listening on udp/{sim.port} (community '{a.community}') — Ctrl+C to stop")
    try:
        sim.thread.join()
    except KeyboardInterrupt:
        sim.stop()
