"""UrFleet DCA test suite.  Run:  python -m unittest discover -s tests -v   (from urfleet/dca)"""
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
for _k in ("NO_PROXY", "no_proxy"):
    os.environ[_k] = "127.0.0.1,localhost"
sys.path.insert(0, str(HERE.parent))

import urfleet_dca as d  # noqa: E402
from simulator import SnmpSimulator, hp_mono, xerox_color  # noqa: E402


class BerTests(unittest.TestCase):
    def test_integer_roundtrip(self):
        for v in (0, 1, 127, 128, 255, 256, -1, -128, -129, 2**31 - 1, -(2**31)):
            tag, body, _ = d.ber_decode(d.ber_int(v))
            self.assertEqual(d.decode_value(tag, body), v)

    def test_unsigned_roundtrip(self):
        for v in (0, 200, 2**32 - 1, 2**40):
            tag, body, _ = d.ber_decode(d.ber_int(v, d.TAG_COUNTER64))
            self.assertEqual(d.decode_value(tag, body), v)

    def test_oid_roundtrip(self):
        for o in ("1.3.6.1.2.1.43.10.2.1.4.1.1", "1.3.6.1.4.1.253.8.53.13.2.1.6.1.20.34", "1.3.6.1.4.1.18334.1"):
            _t, body, _ = d.ber_decode(d.ber_oid(o))
            self.assertEqual(d.oid_to_str(d.decode_oid(body)), o)

    def test_long_length(self):
        payload = b"x" * 300
        tag, body, end = d.ber_decode(d.ber_octets(payload))
        self.assertEqual(body, payload)

    def test_message_roundtrip(self):
        msg = d.build_message(1, "public", d.PDU_GET, 42, [("1.3.6.1.2.1.1.1.0", d.ber_null())])
        parsed = d.parse_message(msg)
        self.assertEqual(parsed["request_id"], 42)
        self.assertEqual(parsed["community"], "public")
        self.assertEqual(d.oid_to_str(parsed["varbinds"][0][0]), "1.3.6.1.2.1.1.1.0")


class HelperTests(unittest.TestCase):
    def test_expand_targets(self):
        self.assertEqual(len(d.expand_targets(["192.168.1.0/24"])), 254)
        self.assertEqual(d.expand_targets(["10.0.0.5-7"]), ["10.0.0.5", "10.0.0.6", "10.0.0.7"])
        self.assertEqual(d.expand_targets(["10.0.0.5-10.0.0.6", "10.0.0.6"]), ["10.0.0.5", "10.0.0.6"])
        self.assertEqual(d.expand_targets(["10.0.0.0/30"], exclude=["10.0.0.1"]), ["10.0.0.2"])

    def test_supply_level(self):
        self.assertEqual(d.supply_level_pct(50, 200), 25.0)
        self.assertIsNone(d.supply_level_pct(-3, 100))
        self.assertEqual(d.supply_level_pct(40, -2), 40.0)
        self.assertIsNone(d.supply_level_pct(400, -2))

    def test_error_state(self):
        self.assertEqual(d.decode_error_state(b"\x20\x00"), ["low_toner"])
        self.assertEqual(d.decode_error_state(b"\x05\x80"), ["jammed", "service_requested", "input_tray_missing"])

    def test_reconcile(self):
        self.assertEqual(d.reconcile_counters(1000, 600, 400, True)[3], "vendor")
        self.assertEqual(d.reconcile_counters(1000, None, None, False), (1000, 1000, 0, "derived"))
        self.assertEqual(d.reconcile_counters(1000, 700, None, True), (1000, 700, 300, "derived"))
        self.assertEqual(d.reconcile_counters(1000, None, None, True)[3], "total_only")
        # garbage vendor numbers that don't reconcile are discarded
        self.assertEqual(d.reconcile_counters(1000, 5000, 9000, True)[3], "total_only")

    def test_vendor_detection(self):
        self.assertEqual(d.vendor_from((1, 3, 6, 1, 4, 1, 253, 8), None, None), "XEROX")
        self.assertEqual(d.vendor_from(None, "KYOCERA Document Solutions Printing System", None), "KYOCERA")
        self.assertEqual(d.vendor_from(None, None, "bizhub C300i"), "KONICA-MINOLTA")


class SimulatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.xerox = SnmpSimulator(xerox_color()).start()
        cls.hp = SnmpSimulator(hp_mono(), community="s3cret").start()

    @classmethod
    def tearDownClass(cls):
        cls.xerox.stop()
        cls.hp.stop()

    def test_get_and_walk_v2c(self):
        c = d.SnmpClient("127.0.0.1", port=self.xerox.port, timeout=1)
        v = c.get(["1.3.6.1.2.1.43.5.1.1.17.1", "1.3.6.1.2.1.1.99.0"])
        self.assertEqual(v["1.3.6.1.2.1.43.5.1.1.17.1"], b"4AV775587")
        self.assertIsNone(v["1.3.6.1.2.1.1.99.0"])
        rows = c.walk("1.3.6.1.2.1.43.11.1.1.6")
        self.assertEqual(len(rows), 6)

    def test_walk_v1(self):
        c = d.SnmpClient("127.0.0.1", version="1", port=self.xerox.port, timeout=1)
        self.assertEqual(len(c.walk("1.3.6.1.2.1.43.11.1.1.9")), 6)
        # v1 noSuchName fallback
        v = c.get(["1.3.6.1.2.1.43.5.1.1.17.1", "1.3.6.1.2.1.1.99.0"])
        self.assertEqual(v["1.3.6.1.2.1.43.5.1.1.17.1"], b"4AV775587")

    def test_wrong_community_times_out(self):
        c = d.SnmpClient("127.0.0.1", "public", port=self.hp.port, timeout=0.3, retries=0)
        with self.assertRaises(d.SnmpTimeout):
            c.get(["1.3.6.1.2.1.1.1.0"])

    def test_collect_xerox_color(self):
        dev = d.collect_device("127.0.0.1", "public", port=self.xerox.port, timeout=1)
        self.assertEqual(dev["manufacturer"], "XEROX")
        self.assertEqual(dev["serial"], "4AV775587")
        self.assertEqual(dev["model"], "Phaser 6510")
        self.assertTrue(dev["is_color"])
        self.assertEqual(dev["mac"], "00:00:AA:12:34:56")
        self.assertEqual(dev["meters"], {"total": 182400, "mono": 61100, "color": 121300, "quality": "vendor"})
        black = next(s for s in dev["supplies"] if s["color"] == "black" and s["type"] == "toner")
        self.assertEqual(black["level_pct"], 2.0)
        waste = next(s for s in dev["supplies"] if s["type"] == "waste_toner")
        self.assertIsNone(waste["level_pct"])
        self.assertTrue(waste["some_remaining"])
        self.assertEqual(dev["errors"], ["low_toner"])
        self.assertEqual(dev["alerts"][0]["description"], "Black Toner Cartridge is low")
        self.assertEqual(dev["technology"], "Laser")

    def test_collect_hp_mono_derives_split(self):
        dev = d.collect_device("127.0.0.1", "s3cret", port=self.hp.port, timeout=1)
        self.assertEqual(dev["manufacturer"], "HP")
        self.assertFalse(dev["is_color"])
        self.assertEqual(dev["meters"]["mono"], 54210)
        self.assertEqual(dev["meters"]["color"], 0)
        self.assertEqual(dev["supplies"][0]["level_pct"], 42.0)

    def test_quick_probe_tries_communities(self):
        res = d.quick_probe("127.0.0.1", ["public", "s3cret"], "2c", 0.3, 0, port=self.hp.port)
        self.assertEqual(res[0], "s3cret")


class _Ingest(BaseHTTPRequestHandler):
    received = []
    fail = False

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if _Ingest.fail:
            self.send_response(503)
            self.end_headers()
            return
        _Ingest.received.append((self.headers.get("x-dca-key"), body))
        out = json.dumps({"ok": True, "config": {"interval_minutes": 60, "config_version": 2},
                          "commands": [{"id": "c1", "command": "ping"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.sim = SnmpSimulator(xerox_color()).start()
        self.http = HTTPServer(("127.0.0.1", 0), _Ingest)
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.tmp = tempfile.TemporaryDirectory()
        _Ingest.received.clear()
        _Ingest.fail = False
        cfg = dict(d.DEFAULT_CONFIG)
        cfg.update(endpoint=f"http://127.0.0.1:{self.http.server_port}/functions/v1/dca-ingest", key="dca_test_key",
                   ranges=["127.0.0.1"], snmp_port=self.sim.port, timeout=0.5, retries=0, workers=4,
                   spool_dir=os.path.join(self.tmp.name, "spool"), log_file=os.path.join(self.tmp.name, "dca.log"))
        self.cfg_path = os.path.join(self.tmp.name, "dca.json")
        self.agent = d.Agent(cfg, self.cfg_path)

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.sim.stop()
        self.tmp.cleanup()

    def test_cycle_upload_and_remote_config(self):
        payload = self.agent.cycle()
        self.assertEqual(len(payload["devices"]), 1)
        self.assertTrue(payload["scan"]["full_discovery"])
        resp = self.agent.upload(payload)
        self.assertTrue(resp["ok"])
        key, body = _Ingest.received[0]
        self.assertEqual(key, "dca_test_key")
        self.assertEqual(body["devices"][0]["serial"], "4AV775587")
        self.assertNotIn("community_used", body["devices"][0])  # never ship credentials
        self.assertEqual(self.agent.cfg["interval_minutes"], 60)  # remote config applied
        self.assertTrue(Path(self.cfg_path).exists())             # and persisted
        self.assertEqual(self.agent.command_results[0]["command"], "ping")
        # second cycle re-polls known printers without full discovery and reports command results
        p2 = self.agent.cycle()
        self.assertFalse(p2["scan"]["full_discovery"])
        self.assertEqual(p2["command_results"][0]["id"], "c1")

    def test_spool_when_offline_then_replay(self):
        _Ingest.fail = True
        self.assertIsNone(self.agent.upload(self.agent.cycle()))
        spooled = list(Path(self.agent.spool).glob("pending-*.json"))
        self.assertEqual(len(spooled), 1)
        _Ingest.fail = False
        self.agent.upload(self.agent.cycle())
        self.assertEqual(len(_Ingest.received), 2)  # live + replayed
        self.assertTrue(_Ingest.received[1][1].get("replayed"))
        self.assertEqual(list(Path(self.agent.spool).glob("pending-*.json")), [])


class CliTests(unittest.TestCase):
    def test_version(self):
        self.assertEqual(d.main(["version"]), 0)

    def test_init_writes_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "dca.json")
            d.main(["-c", path, "init", "--endpoint", "https://x.supabase.co/functions/v1/dca-ingest",
                    "--key", "k", "--range", "10.0.0.0/24"])
            cfg = json.loads(Path(path).read_text())
            self.assertEqual(cfg["ranges"], ["10.0.0.0/24"])
            self.assertEqual(cfg["key"], "k")


if __name__ == "__main__":
    unittest.main()
