# EXPERIMENTAL / NON-PRODUCT / MECHANICS VALIDATION

Synthetic mechanics runner for `docs/ai-cutter-research/17_EXPERIENCE_POC_CONTRACT.md`.

This directory is not Resonance, not AI Cutter, and not the Experience Vault. It does not import product code. It does not call a model. A mechanics pass checks the runner on a corpus whose hidden rule is the candidate margin rule. It does not show that human editing preferences generalize.

```bash
python3 experiment.py
python3 -m unittest discover -s tests -v
```

Artifacts are written to `artifacts/`. The research contract is not modified.
