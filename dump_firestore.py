import json, urllib.request

KEY = "AIzaSyC7qj3lvZq6XvwJqSkiQIbasOl5vLi8HHs"
BASE = "https://firestore.googleapis.com/v1/projects/fireguard-monitor/databases/(default)/documents/"

def get(coll):
    url = BASE + coll + "?key=" + KEY + "&pageSize=100"
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def val(f, k):
    v = f.get(k)
    if v is None:
        return None
    for t in ("stringValue", "integerValue", "booleanValue", "doubleValue"):
        if t in v:
            return v[t]
    if "timestampValue" in v:
        return v["timestampValue"]
    if "nullValue" in v:
        return None
    if "mapValue" in v:
        return {kk: val(v["mapValue"]["fields"], kk) for kk in v["mapValue"]["fields"]}
    return str(v)

out = {}
for coll in ("panels", "gateways", "buildings", "events", "eventos"):
    try:
        d = get(coll)
    except Exception as e:
        out[coll] = {"error": str(e)}
        continue
    docs = []
    for doc in d.get("documents", []):
        f = doc.get("fields", {})
        docs.append({k: val(f, k) for k in f})
    out[coll] = docs

with open("firestore_dump.json", "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False, indent=2, sort_keys=True)

for coll, docs in out.items():
    print(f"{coll}: {len(docs) if isinstance(docs, list) else docs}")
