import collections
import json
import re
import sys

corpus, words_file, out_file = sys.argv[1], sys.argv[2], sys.argv[3]
MIN_COUNT, MAX_RANK = 4, 15000

rank, vocab, part, n = {}, set(), 0, 0
for line in open(words_file):
    w = line.strip()
    if not w or w.startswith("#cheeseburger"):
        continue
    if w.startswith("#"):
        part += 1
        continue
    n += 1
    vocab.add(w)
    if part == 0:
        rank[w] = n

pairs, left = collections.Counter(), collections.Counter()
for conv in json.load(open(corpus)).values():
    for turn in conv["content"]:
        for sentence in re.split(r"[.!?\n]+", turn["message"].lower()):
            ws = [w.replace("'", "") for w in re.findall(r"[a-z]+(?:'[a-z]+)?", sentence)]
            if not ws:
                continue
            seq = ["^"] + [w if w in vocab else "?" for w in ws] + ["$"]
            for a, b in zip(seq, seq[1:]):
                if a == "?":
                    continue
                left[a] += 1
                if b != "?":
                    pairs[(a, b)] += 1

ok = lambda w: w in ("^", "$") or rank.get(w, 1 << 30) <= MAX_RANK
rows = collections.defaultdict(list)
for (a, b), c in pairs.items():
    if c >= MIN_COUNT and ok(a) and ok(b):
        rows[a].append((b, c))
lines = ["#cheeseburger-context v1"]
for a in sorted(rows, key=lambda w: -left[w]):
    lines.append(f"{a} {left[a]} " + " ".join(f"{b}:{c}" for b, c in sorted(rows[a], key=lambda x: -x[1])))
open(out_file, "w").write("\n".join(lines) + "\n")
print(f"context: {len(rows)} words, {sum(len(r) for r in rows.values())} pairs")
