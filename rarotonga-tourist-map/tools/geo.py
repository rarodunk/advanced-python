"""Real coordinates for every place, applied to every version of the guide.

Each place carries `ll: [lat, lon]` (WGS84). The pages derive whatever their
map needs from it: the cartoon's bearing and radius, the 3D world position,
the painting's pixel, Directions links. Nothing is placed by hand any more.

Coordinates come from published addresses and mapping; expect roughly a block
of error (100–300 m) on the smaller businesses. Businesses can correct their
own pin in the app once they claim their listing.

Usage:  python3 tools/geo.py    (idempotent; rewrites index.html and v2/index.html)
"""
import pathlib, re, sys

LL = {
    # Avarua and the north
    "traderjacks":   (-21.2046, -159.7769),
    "punanganui":    (-21.2042, -159.7802),
    "cicc":          (-21.2064, -159.7752),
    "tamarind":      (-21.2088, -159.7628),
    "palace":        (-21.2058, -159.7762),
    "museum":        (-21.2080, -159.7738),
    "licence":       (-21.2062, -159.7748),
    "bus":           (-21.2052, -159.7786),
    "rarosafari":    (-21.2060, -159.7796),
    "fridaynight":   (-21.2060, -159.7770),
    "selfcater":     (-21.2066, -159.7792),
    "money":         (-21.2062, -159.7758),
    "fishingclub":   (-21.2039, -159.7776),
    "avatiu":        (-21.2036, -159.7842),
    "progressive":   (-21.2100, -159.7800),
    "saturdaysport": (-21.2065, -159.8010),   # National Stadium, Nikao
    "maraearai":     (-21.2115, -159.7615),   # Arai-te-Tonga, Tupapa
    "matavera":      (-21.2245, -159.7360),
    "aitutaki":      (-21.1990, -159.7950),   # departs the airport
    "gamefish":      (-21.1950, -159.7760),   # outside the reef, north
    # Nikao and the airport
    "airport":       (-21.2027, -159.7942),   # terminal
    "airraro":       (-21.2030, -159.7950),
    "nikaobeach":    (-21.2050, -159.8000),
    "golf":          (-21.2078, -159.8090),
    "blackrock":     (-21.2168, -159.8195),
    "hospital":      (-21.2270, -159.8105),
    "arametua":      (-21.2160, -159.7920),
    # Arorangi and the west
    "albertos":      (-21.2280, -159.8250),
    "diveraro":      (-21.2270, -159.8250),
    "islandnight":   (-21.2295, -159.8265),
    "otb":           (-21.2345, -159.8275),
    "rickshaw":      (-21.2365, -159.8272),
    "kikau":         (-21.2385, -159.8280),
    "storytellers":  (-21.2410, -159.8265),
    "adventuredive": (-21.2335, -159.8270),
    "whalecentre":   (-21.2310, -159.8195),
    "highland":      (-21.2405, -159.8180),
    "raemaru":       (-21.2364, -159.8100),
    "stay-arorangi": (-21.2330, -159.8262),
    "whales":        (-21.2450, -159.8420),   # outside the reef, west
    # Aroa and Rutaki
    "waterline":     (-21.2520, -159.8268),
    "wilsons":       (-21.2550, -159.8255),
    "aroa":          (-21.2570, -159.8245),
    "shipwreck":     (-21.2465, -159.8275),
    # The south: Vaimaanga and Titikaveka
    "wigmores":      (-21.2600, -159.7770),
    "sheraton":      (-21.2755, -159.7900),
    "vaima":         (-21.2640, -159.7935),   # published GPS, Vaimaanga beachfront
    "nustall":       (-21.2790, -159.7800),
    "titikavekacicc":(-21.2790, -159.7640),
    "matutu":        (-21.2745, -159.7690),
    "charlies":      (-21.2770, -159.7535),
    "mairenui":      (-21.2705, -159.7580),
    "stay-titikaveka":(-21.2780, -159.7650),
    "fruits":        (-21.2755, -159.7480),
    "honesty":       (-21.2760, -159.7480),
    "takitumu":      (-21.2610, -159.7500),
    # Muri and Ngatangiia
    "murimarket":    (-21.2610, -159.7395),
    "tevaranui":     (-21.2660, -159.7415),
    "sails":         (-21.2620, -159.7375),
    "lbv":           (-21.2635, -159.7410),
    "tapabar":       (-21.2648, -159.7380),
    "murilagoon":    (-21.2625, -159.7300),
    "lagooncruise":  (-21.2620, -159.7370),
    "koka":          (-21.2615, -159.7365),
    "kitesurf":      (-21.2695, -159.7345),
    "reefkit":       (-21.2600, -159.7420),
    "stay-muri":     (-21.2625, -159.7390),
    "avana":         (-21.2470, -159.7330),
    "mooring":       (-21.2478, -159.7345),
    # The interior
    "temanga":       (-21.2300, -159.7608),
    "crossisland":   (-21.2410, -159.7815),   # Te Rua Manga, the Needle
    "pastrek":       (-21.2220, -159.7800),   # northern trailhead
    "stay-avarua":   (-21.2060, -159.7775),
}

DISTRICT_FIX = { "shipwreck": "Aroa / Rutaki" }

def apply(path):
    p = pathlib.Path(path); s = p.read_text(); n = 0
    def sub(m):
        nonlocal n
        pid = m.group(2)
        if pid not in LL: return m.group(0)
        n += 1
        lat, lon = LL[pid]
        return f'{m.group(1)}{DISTRICT_FIX.get(pid, m.group(3))}", ll:[{lat:.4f},{lon:.4f}],'
    s = re.sub(r'(\{ id:"([^"]+)",[^\n]*?district:")([^"]*)",(?: ll:\[[^\]]*\],)?', sub, s)
    p.write_text(s)
    ids = set(re.findall(r'\{ id:"([^"]+)", name:', s))
    print(f"{path}: {n} places given coordinates; without: {sorted(i for i in ids if i not in LL)}")

if __name__ == "__main__":
    base = pathlib.Path(__file__).resolve().parent.parent
    for f in ["index.html", "v2/index.html"]:
        apply(base / f)
