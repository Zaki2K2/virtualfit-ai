# Synthetic fashion seed data

Generated deterministically by `../tools/prepare_data.py` from original authored fashion scenarios and public sample catalog descriptions in this repository. No user messages, photos, measurements, scraped datasets, or private wardrobe records are used.

32 training / 8 validation / 8 test examples. Each row includes provenance and system/user/assistant messages; the user context contains the available garments and the assistant target contains natural-language advice, wardrobe IDs, occasion and categories. Validator checks request uniqueness and target grounding.

Held-out wording differs, but scenarios and garments overlap. This is a small engineering bootstrap corpus, not an independently sampled fashion benchmark. Do not use it to claim broad quality, generalization, fairness or successful customization. Add diverse, reviewed examples and scenario-disjoint holdouts before serious model training.
