import collections
import json
import re
import sys

corpus, out_file = sys.argv[1], sys.argv[2]
caps, total = collections.Counter(), collections.Counter()
for conv in json.load(open(corpus)).values():
    for turn in conv["content"]:
        for sentence in re.split(r"[.!?\n]+", turn["message"]):
            ws = re.findall(r"[A-Za-z]+", sentence)
            for i, w in enumerate(ws):
                if i == 0 or w.isupper():
                    continue
                low = w.lower()
                total[low] += 1
                if w[0].isupper():
                    caps[low] += 1
lines = [f"{w} {total[w]} {caps[w]}" for w in sorted(total) if total[w] >= 1]
open(out_file, "w").write("\n".join(lines) + "\n")
print(f"casing for {len(lines)} words")
