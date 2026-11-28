"""Build public/data/airports.json from the OurAirports CSVs (public domain,
https://davidmegginson.github.io/ourairports-data/).

Usage: python -I tools/build-airports.py <airports.csv> <runways.csv> <out.json>

Keeps small / medium / large airports with at least one open runway of 1,000 ft or more (no
water runways, no helipads). Output (compact, loaded only in real-world mode):
  { "v": 1, "a": [[ident, name, place, country, size, lat, lon, elevFt, [runway, ...]], ...] }
  size: 0 small, 1 medium, 2 large
  runway: [leIdent, heIdent, leLat, leLon, heLat, heLon, lengthFt, widthFt, surface, headingTrue]
  surface: 0 asphalt / concrete, 1 grass, 2 dirt / gravel
  Runway ends are null when the data has no coordinates; heading is then from the data or the
  runway number, and the game places the runway on the airport's reference point.
"""
import csv
import json
import sys

SIZES = {"small_airport": 0, "medium_airport": 1, "large_airport": 2}
PAVED = ("ASP", "CON", "PEM", "BIT", "TAR", "PAV", "TRE", "MAC", "ASPH", "CONC")
GRASS = ("GRS", "GRASS", "TURF", "GRE")


def surface(s: str):
    s = (s or "").upper()
    if not s:
        return 0
    if "WATER" in s or s.startswith("WAT"):
        return None
    if any(s.startswith(p) or p in s for p in PAVED):
        return 0
    if any(s.startswith(g) or g in s for g in GRASS):
        return 1
    return 2


def num(v, cast=float):
    try:
        return cast(v)
    except (TypeError, ValueError):
        return None


def heading_from_ident(ident: str):
    digits = "".join(ch for ch in ident if ch.isdigit())
    if not digits:
        return None
    n = int(digits)
    return (n % 36) * 10.0 if 1 <= n <= 36 else None


def main(airports_csv: str, runways_csv: str, out: str) -> None:
    airports = {}
    with open(airports_csv, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            size = SIZES.get(row["type"])
            if size is None:
                continue
            lat, lon = num(row["latitude_deg"]), num(row["longitude_deg"])
            if lat is None or lon is None:
                continue
            airports[row["id"]] = [
                row["ident"], row["name"].strip(), (row["municipality"] or "").strip(), row["iso_country"],
                size, round(lat, 5), round(lon, 5), num(row["elevation_ft"], int) or 0, [],
            ]
    kept = 0
    with open(runways_csv, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            a = airports.get(row["airport_ref"])
            if a is None or row["closed"] == "1":
                continue
            le, he = (row["le_ident"] or "").strip(), (row["he_ident"] or "").strip()
            if le.upper().startswith("H") or he.upper().startswith("H"):
                continue
            length, width = num(row["length_ft"], int), num(row["width_ft"], int)
            if not length or length < 1000:
                continue
            surf = surface(row["surface"])
            if surf is None:
                continue
            hdg = num(row["le_heading_degT"])
            if hdg is None:
                hdg = heading_from_ident(le)
            if hdg is None:
                continue
            ends = [num(row[k]) for k in ("le_latitude_deg", "le_longitude_deg", "he_latitude_deg", "he_longitude_deg")]
            if any(e is None for e in ends):
                ends = [None] * 4
            else:
                ends = [round(e, 5) for e in ends]
            a[8].append([le, he, *ends, length, width or max(50, length // 40), surf, round(hdg, 1)])
            kept += 1
    rows = [a for a in airports.values() if a[8]]
    rows.sort(key=lambda a: (-a[4], a[0]))
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "a": rows}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(rows)} airports, {kept} runways -> {out}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
