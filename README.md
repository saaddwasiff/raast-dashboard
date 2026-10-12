# Raast Growth Dashboard

Internal dashboard tracking Raast (Pakistan's instant payment system) from SBP monthly Raast reporting and the SBP Payment Systems Review. Built and maintained by the Raast Ecosystem Development team, Karandaaz Pakistan.

The whole dashboard is one self-contained file, `index.html`. The data is embedded in the file; the charting libraries load from cdnjs.

## Monthly update

1. Open the live site and go to **Data & update**.
2. Load the new SBP monthly Raast workbook and, when a new PSR is out, `Raast_PSR_Data.xlsx`.
3. Click **Check files** and review the summary and data checks.
4. Click **Download updated index.html**.
5. In this repository, click **Add file → Upload files**, drop in the new `index.html`, and commit. The site refreshes within a minute or two.

## Hosting

Served with GitHub Pages from the `main` branch, root folder. `robots.txt` and a `noindex` tag ask search engines not to list the site, but anyone with the link can open it.
