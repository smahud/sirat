#!/usr/bin/env python3
"""Verifikasi runtime v1.9 lokal (server :3967 via setup-local-v19.sh).
Skenario: start counter terusan, reset bulanan, arsip-hapus adaptif, pulihkan."""
import json
import sys
import urllib.request
import http.cookiejar

BASE = "http://localhost:3967"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

PASS = 0
FAIL = 0


def req(method, path, body=None, headers=None):
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with opener.open(r) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def check(desc, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS: {desc}")
    else:
        FAIL += 1
        print(f"  FAIL: {desc} {detail}")


code, me = req("POST", "/api/auth/login", {"username": "admin", "password": "V19-Local-E2e-2026!"})
check("login admin", code == 200 and me.get("user", {}).get("username") == "admin", str(me)[:200])

_, units = req("GET", "/api/units")
mi = next(u["id"] for u in units["units"] if u["code"] == "MI")
_, lts = req("GET", "/api/letter-types")
ts = lts.get("letterTypes") or lts.get("types") or []
spr = next(t["id"] for t in ts if t["code"] == "SPR")
print(f"  MI={mi} SPR={spr}")

DSL = {
    "version": 2, "separator": "/",
    "fields": [{
        "type": "dropdown", "key": "arah_surat", "label": "Arah Surat",
        "placeholder": "Pilih arah", "helperText": None,
        "options": [
            {"id": "internal", "label": "Internal", "code": "A", "active": True},
            {"id": "eksternal", "label": "Eksternal", "code": "B", "active": True},
        ],
        "defaultOptionId": None, "required": True, "order": 0,
    }],
    "components": [
        {"type": "sequence", "padding": 3},
        {"type": "fieldRef", "field": "arah_surat"},
        {"type": "letterTypeCode"}, {"type": "unitCode"},
        {"type": "letterDate", "format": "MONTH_ROMAN"},
        {"type": "letterDate", "format": "YEAR_4"},
    ],
    "policy": {"resetPolicy": "MONTHLY", "dateSource": "LETTER_DATE", "startCounter": 25},
}


def mk_draft(letter_date, profile_id):
    code, body = req("POST", "/api/letters", {
        "issuingUnitId": mi, "numberingProfileId": profile_id,
        "letterTypeId": spr, "letterDate": letter_date,
        "fieldValues": {"arah_surat": "internal"},
        "subject": "Uji v1.9", "recipient": "Tester",
    })
    return code, body.get("letter", {}).get("id")


def issue(letter_id, key):
    code, body = req("POST", f"/api/letters/{letter_id}/issue", None,
                     headers={"Idempotency-Key": key})
    return code, body.get("officialNumber") or json.dumps(body.get("error") or body)[:220]


print("== K1: buat profil terusan (startCounter=25, MONTHLY) ==")
code, body = req("POST", "/api/numbering-profiles",
                 {"name": "Profil Terusan MI", "ownerId": mi, "committeeId": None, "dsl": DSL})
check("profil dibuat", code == 201 and body.get("profile", {}).get("id"), str(body)[:200])
prof = body["profile"]["id"]
ver = body["version"]["id"]

print("== K2: aktivasi (MONTHLY / LETTER_DATE) ==")
code, body = req("POST", "/api/numbering-profiles/activate",
                 {"versionId": ver, "resetPolicy": "MONTHLY", "dateSource": "LETTER_DATE"})
check("aktivasi ok", code == 200, str(body)[:200])

print("== K3: preview estimasi mulai 025 (counter belum ada) ==")
_, body = req("GET", f"/api/letters/preview?unitId={mi}&profileId={prof}&letterTypeId={spr}&letterDate=2026-09-15&fields=%7B%22arah_surat%22%3A%22internal%22%7D")
check("preview 025/A/SPR/MI/IX/2026", body.get("previewNumber") == "025/A/SPR/MI/IX/2026", str(body)[:220])

print("== K4: terbit #1 (15 Sep) → 025 (terusan dari 24) ==")
_, l1 = mk_draft("2026-09-15", prof)
c, n1 = issue(l1, "v19-cek-0001")
check("nomor #1 = 025/A/SPR/MI/IX/2026", n1 == "025/A/SPR/MI/IX/2026", n1)

print("== K5: terbit #2 (20 Sep) → 026 (counter berjalan) ==")
_, l2 = mk_draft("2026-09-20", prof)
c, n2 = issue(l2, "v19-cek-0002")
check("nomor #2 = 026/A/SPR/MI/IX/2026", n2 == "026/A/SPR/MI/IX/2026", n2)

print("== K6: terbit #3 (5 Okt) → 025 lagi (reset bulanan → kembali ke start) ==")
_, l3 = mk_draft("2026-10-05", prof)
c, n3 = issue(l3, "v19-cek-0003")
check("nomor #3 = 025/A/SPR/MI/X/2026", n3 == "025/A/SPR/MI/X/2026", n3)

print("== K6.5: siapkan draft #4 SEBELUM arsip (untuk uji terbit pasca-arsip) ==")
c, l4 = mk_draft("2026-10-06", prof)
check("draft #4 dibuat", c == 201 and l4, f"{c} {l4}")

print("== K7: DELETE profil ber-histori → ARSIP (bukan hapus fisik) ==")
code, body = req("DELETE", f"/api/numbering-profiles?id={prof}")
check("DELETE → archived:true letterCount:4 (3 terbit + 1 draft)",
      body.get("archived") is True and body.get("letterCount") == 4, str(body)[:220])

print("== K8: profil hilang dari daftar utama ==")
_, body = req("GET", "/api/numbering-profiles")
ids = [p["id"] for p in body["profiles"]]
check("profil tidak ada di daftar utama", prof not in ids)

print("== K9: profil muncul di ?archived=1 dengan letterCount=4 ==")
_, body = req("GET", "/api/numbering-profiles?archived=1")
row = next((p for p in body["profiles"] if p["id"] == prof), None)
check("arsip memuat profil + letterCount=4", row is not None and row["letterCount"] == 4,
      str(row)[:200])

print("== K10: preview tidak menawarkan profil terarsip; eksplisit → 409 PROFILE_ARCHIVED ==")
_, body = req("GET", f"/api/letters/preview?unitId={mi}&letterTypeId={spr}&letterDate=2026-10-06&fields=%7B%22arah_surat%22%3A%22internal%22%7D")
check("profiles[] bebas profil terarsip", prof not in [p["id"] for p in body.get("profiles", [])])
code, body = req("GET", f"/api/letters/preview?unitId={mi}&profileId={prof}&letterTypeId={spr}&letterDate=2026-10-06")
check("preview eksplisit → PROFILE_ARCHIVED", code == 409 and body.get("error", {}).get("code") == "PROFILE_ARCHIVED", f"{code} {str(body)[:180]}")

print("== K11: draft pra-arsip gagal terbit → 409 PROFILE_ARCHIVED ==")
code, err = issue(l4, "v19-cek-0004")
check("issue → PROFILE_ARCHIVED", code == 409 and "PROFILE_ARCHIVED" in err, f"{code} {err}")

print("== K12: UNARCHIVE → profil kembali ==")
code, body = req("POST", "/api/numbering-profiles/unarchive", {"id": prof})
check("unarchive ok", code == 200, str(body)[:200])
_, body = req("GET", "/api/numbering-profiles")
ids = [p["id"] for p in body["profiles"]]
check("profil kembali di daftar utama", prof in ids)

print("== K13: pasca-pulih — draft #4 terbit 026; draft baru terbit 027 ==")
c, n4 = issue(l4, "v19-cek-0004")
check("nomor #4 = 026/A/SPR/MI/X/2026", n4 == "026/A/SPR/MI/X/2026", n4)
_, l5 = mk_draft("2026-10-06", prof)
c, n5 = issue(l5, "v19-cek-0005")
check("nomor #5 = 027/A/SPR/MI/X/2026", n5 == "027/A/SPR/MI/X/2026", n5)

print("== K14: profil TAK terpakai → DELETE = hapus permanen ==")
dsl2 = json.loads(json.dumps(DSL))
dsl2["policy"]["startCounter"] = 1
code, body = req("POST", "/api/numbering-profiles",
                 {"name": "Profil Seken MI", "ownerId": mi, "committeeId": None, "dsl": dsl2})
prof2 = body["profile"]["id"]
code, body = req("DELETE", f"/api/numbering-profiles?id={prof2}")
check("DELETE unused → deleted:true", body.get("deleted") is True, str(body)[:200])
_, body = req("GET", "/api/numbering-profiles?archived=1")
check("profil unused tidak masuk arsip", prof2 not in [p["id"] for p in body["profiles"]])

print("== K15: GET daftar menyertakan letterCount ==")
_, body = req("GET", "/api/numbering-profiles")
check("field letterCount ada di semua baris", all("letterCount" in p for p in body["profiles"]))

print()
print(f"HASIL: PASS={PASS} FAIL={FAIL}")
sys.exit(0 if FAIL == 0 else 1)
