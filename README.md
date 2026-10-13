# Raast Growth Dashboard

Internal dashboard tracking Raast (Pakistan's instant payment system) from SBP monthly Raast reporting and the SBP Payment Systems Review. Built and maintained by the Raast Ecosystem Development team, Karandaaz Pakistan.

Live site: https://raast-dashboard.vercel.app/

## Updating the data

1. Open the `data/inbox` folder in this repository and click **Add file → Upload files**.
2. Drop in the new SBP monthly Raast workbook (.xlsx) and/or the new Payment Systems Review PDF, then click **Commit changes**.
3. Within a few minutes the site updates by itself. The files move to `data/processed/<date>/`.
4. Open `data/last-update.md` to see what was read, what changed, and any figures to confirm with SBP.

If a file can't be read (for example SBP changes a table layout), nothing on the site changes, the run shows as failed in the **Actions** tab, and `data/last-update.md` explains why.

Older PSR issues never overwrite figures that came from a newer issue or from an SBP Annual Review.

## Automatic PSR check

On the 1st and 16th of every month the automation checks SBP's [Payment Systems Review page](https://www.sbp.org.pk/our-operations/publications/payment-systems-review/365). If a new quarterly issue has been published, it downloads the PDF, updates the dashboard and records the issue in `data/psr-seen.json`. To check immediately, open **Actions → Update dashboard → Run workflow**.

If SBP changes its page so the check cannot read it, the run shows a red cross in **Actions**; uploading the PDF to `data/inbox` manually still works.

## How it works

- `index.html` is the whole dashboard, with the data embedded in it.
- `.github/workflows/update-dashboard.yml` runs when files are added to `data/inbox`: it reads them with `build/update.js` (the same parsing code the dashboard uses) and saves the updated `index.html`.
- Vercel watches the `main` branch and republishes the site whenever `index.html` changes. Raw data and build scripts are excluded from the site by `.vercelignore`.
- `build/lib/` holds the parsing and calculation code shared with the page.

The repository is public: anyone can view the site and the files in it.
