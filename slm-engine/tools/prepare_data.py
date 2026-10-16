"""Create deterministic synthetic bootstrap examples, not a production training corpus."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from virtualfit_slm.data import validate_splits


def main():
    identity = json.loads((ROOT.parent / 'packages/shared/src/nova.json').read_text(encoding='utf8'))
    system = identity['system'] + ' ' + identity['stylingRules']
    # Own authored catalog descriptions; no scraped/personally identifiable content.
    items = [
        ("tee-classic-white", "Classic Crew T-shirt", "tops", "Plain cotton tee in white."),
        ("shirt-oxford-blue", "Oxford Shirt", "tops", "Button-down shirt in blue."),
        ("trousers-chino-khaki", "Chino Trousers", "bottoms", "Straight-fit chinos in khaki."),
        ("trousers-tailored-charcoal", "Tailored Trousers", "bottoms", "Smart charcoal trousers."),
        ("jacket-denim", "Denim Jacket", "outerwear", "Blue denim jacket."),
        ("dress-midi-indigo", "Midi Dress", "dresses", "Sleeveless indigo midi dress."),
    ]
    wardrobe = [dict(zip(["id", "name", "category", "description"], item)) for item in items]
    scenarios = [
        ("casual white tee and khaki trousers, no dresses", ["tee-classic-white", "trousers-chino-khaki"], "casual", ["tops", "bottoms"], "Pair the white cotton tee with khaki chinos for a simple casual outfit."),
        ("blue shirt with smart charcoal trousers for the office", ["shirt-oxford-blue", "trousers-tailored-charcoal"], "office", ["tops", "bottoms"], "Combine the blue Oxford shirt with charcoal tailored trousers for an office outfit."),
        ("a denim layer over a white top, avoid dresses", ["jacket-denim", "tee-classic-white"], "casual", ["outerwear", "tops"], "Layer the blue denim jacket over the white tee for a relaxed look."),
        ("an indigo dress for dinner, no trousers", ["dress-midi-indigo"], "dinner", ["dresses"], "Choose the indigo midi dress for dinner. Check its appearance in the try-on studio."),
        ("a red silk scarf only", [], "", [], "There is no red silk scarf in the available wardrobe. Add one before requesting a recommendation for it."),
        ("explain which category a denim jacket belongs to, without picking an outfit", [], "", ["outerwear"], "A denim jacket belongs to outerwear and can be used as a layer over a top."),
        ("a white top only; exclude jackets and dresses", ["tee-classic-white"], "casual", ["tops"], "The white cotton crew-neck tee matches your preference for a white top."),
        ("a blue office shirt, avoid pants and dresses", ["shirt-oxford-blue"], "office", ["tops"], "The blue Oxford shirt matches your request for an office top."),
    ]
    # Distinct request wording in held-out splits; scenarios overlap, so this tests paraphrases,
    # not generalization to entirely new garments or domains.
    prefixes = {"train": ["Suggest ", "I would like ", "Help me choose ", "Recommend "],
                "validation": ["Can you plan "], "test": ["From my wardrobe, find "]}
    for split, variants in prefixes.items():
        rows = []
        for prefix in variants:
            for index, (request, ids, occasion, categories, answer) in enumerate(scenarios):
                context = {"message": prefix + request + ".", "preferredCategories": [], "wardrobe": wardrobe}
                output = {"answer": answer, "itemIds": ids, "occasion": occasion, "categories": categories}
                rows.append({"id": f"{split}-{len(rows):03d}", "scenario": index, "source": "virtualfit-authored-synthetic-v1", "messages": [
                    {"role": "system", "content": system}, {"role": "user", "content": json.dumps(context)},
                    {"role": "assistant", "content": json.dumps(output)}]})
        (ROOT / "data" / f"{split}.jsonl").write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf8")
    print(json.dumps(validate_splits(ROOT / "data")))


if __name__ == "__main__": main()
