"""Quick spot-check of classifier behavior on realistic inputs."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import json
from train import AMBIGUITY_THRESHOLD, load_corpus, predict, train  # noqa: E402

corpus, _ = load_corpus()
docs = [(p, frozenset([c])) for c, phrases in corpus.items() for p in phrases]
vocab, idf, entries = train(docs)

tests = [
    "i have a headache and fever",
    "my head hurts",
    "fever",
    "cant breathe and chest pain",
    "mataan na dhukkuba fi qaamni na gubaa",
    "garaa kaasaa",
    "my child wont eat",
    "a dog bit me and the wound is bleeding",
    "matan na dukuba",                      # ASR-mangled Oromo (missing doubles)
    "hello how are you",                    # must stay ambiguous
]
for t in tests:
    codes, conf = predict(t, vocab, idf, entries)
    flag = "AMBIG" if (not codes or conf < AMBIGUITY_THRESHOLD) else "ok   "
    print(f"{flag} {conf:.2f} {codes}  <- {t}")
