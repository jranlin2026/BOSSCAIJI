# BOSSCAIJI

BOSSCAIJI contains two Chrome extensions for a BOSS job-posting lead workflow:

- `boss-lead-collector`: collects visible BOSS job cards and exports leads as XLSX.
- `riskbird-company-enricher`: imports BOSS CSV/XLSX files, searches RiskBird, and exports enriched company contact fields.

## Development

Run tests:

```bash
node --test
```

## Chrome Extension Loading

Open `chrome://extensions`, enable developer mode, then load the extension folders under `chrome-extension/`.
