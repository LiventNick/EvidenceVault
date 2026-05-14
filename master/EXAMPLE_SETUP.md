# Master Files Setup Guide

This `master/` folder contains all your source documents and the master Excel file.

## Folder Structure

```
master/
├── master.xlsx                    # REQUIRED: Main Excel data file (create this)
├── Legal_Documents/               # Your legal documents and court filings
├── Financial_Records/             # Bank statements, invoices, receipts
├── Medical_Evidence/              # Medical records and health documentation
└── Correspondence/                # Emails, letters, communications
```

## Creating Your master.xlsx File

Your Excel workbook should have multiple sheets, one for each category of evidence. **You can structure each sheet however you like, as long as you include PDF file links.**

### Flexibility in Structure

You are **not limited** to the examples below. Create whatever column structure makes sense for organizing your specific evidence:

- Fewer columns? That's fine.
- More columns? No problem.
- Different data types? Go ahead.
- Custom categories? Perfect.

The only requirement is: **Include at least one column that contains file paths to your PDF documents.**

### Example Sheet Structures (Choose One or Create Your Own)

#### Option 1: "Financial Evidence" Sheet

| Date       | Description              | Amount   | Category    | Supporting Document                      |
|------------|--------------------------|----------|-------------|------------------------------------------|
| 2025-01-15 | Bank Statement January    | 5,000.00 | Bank        | Financial_Records/Bank_Statement_Jan.pdf |
| 2025-01-20 | Invoice - Legal Fees      | 2,500.00 | Legal       | Legal_Documents/Legal_Invoice_Jan.pdf    |
| 2025-02-01 | Medical Treatment         | 800.00   | Medical     | Medical_Evidence/Doctor_Invoice_Feb.pdf  |

### Example Sheet: "Timeline of Events"

| Date       | Event Description        | Evidence File                    | Notes        |
|------------|--------------------------|----------------------------------|--------------|
| 2024-06-15 | Incident Report Filed    | Legal_Documents/Incident.pdf    | Initial claim|
| 2024-06-20 | Response Received        | Correspondence/Response_Letter.pdf | From defendant |
| 2024-07-01 | Medical Evaluation       | Medical_Evidence/Evaluation.pdf | Third party   |

### Example Sheet: "Correspondence Log"

| Date       | From          | To            | Subject           | File Path                        |
|------------|---------------|---------------|-------------------|----------------------------------|
| 2025-01-10 | Plaintiff     | Defendant     | Demand Letter     | Correspondence/Demand_Letter.pdf |
| 2025-01-15 | Defendant     | Plaintiff     | Response          | Correspondence/Response.pdf      |
| 2025-01-20 | Both          | Court         | Motion Submitted  | Legal_Documents/Motion.pdf       |

## Important Rules

1. **First Row is Headers**: Always put column names in row 1
2. **File Paths Are Required**: You MUST include at least one column with PDF file paths (e.g., `Financial_Records/Receipt.pdf`)
3. **Files Must Exist**: Any file you reference must exist in the `master/` folder
4. **Date Format**: Use MM/DD/YYYY or YYYY-MM-DD
5. **No Circular References**: Excel formulas are okay, but keep them simple
6. **Save as .xlsx**: Always use Excel format, not .xls
7. **Flexible Structure**: Organize columns however you like - there's no required order or naming

## Steps to Set Up

1. **Create your Excel file**:
   - Open Excel
   - Create sheets for each category
   - Add headers in row 1
   - Fill in your evidence data

2. **Save as `master.xlsx`**:
   - File → Save As
   - Filename: `master.xlsx`
   - Location: `master/` folder in this repository
   - Format: `.xlsx` (Excel Workbook)

3. **Add supporting documents**:
   - Place PDFs, images, files in appropriate folders
   - Use the same folder names in your Excel file references

4. **Run the conversion**:
   ```bash
   npm run build
   ```
   This will:
   - Convert your Excel to JSON
   - Generate preview pages
   - Build the website

5. **Test locally**:
   ```bash
   hugo server
   ```
   Visit `http://localhost:1313` to preview

## File Size Limits

- Excel file: No practical limit (tested up to 100MB)
- Individual PDFs: Recommend under 50MB each
- Total folder size: Keep under 1GB for optimal performance

## Troubleshooting

**"Missing linked file" warnings:**
- These appear when you reference a file that doesn't exist yet
- Safe to ignore if the file isn't ready
- Add the file when you have it

**Build fails with Excel error:**
- Ensure file is saved as `.xlsx` format
- Close the file in Excel before building
- Check for circular formula references

**Files not appearing in preview:**
- Verify file path in Excel matches folder structure exactly
- Check that files are in `master/` folder, not elsewhere
- Try moving file to a simpler path (no spaces/special chars)

## Examples of File Paths

✅ **Correct:**
- `Legal_Documents/Motion.pdf`
- `Financial_Records/Invoice_2025_01.pdf`
- `Medical_Evidence/Dr_Report.pdf`

❌ **Incorrect:**
- `./Legal_Documents/Motion.pdf` (don't use ./)
- `/Legal_Documents/Motion.pdf` (don't start with /)
- `Legal Documents/Motion.pdf` (spaces in folder names not recommended)
- `http://example.com/file.pdf` (external links don't work)

---

Once you've set up your `master.xlsx` and organized your documents, run `npm run build` and everything will be processed automatically!

## Why PDF File Links Are Essential

When you include file paths in your Excel columns:

1. **Automatic Preview Pages**: The system generates clickable preview pages for each PDF
2. **Dashboard Links**: Your website displays interactive links to all evidence
3. **Access Control**: PDFs are protected behind password authentication
4. **Evidence Organization**: Files are organized and catalogued by your Excel structure
5. **Print Prevention**: PDFs displayed in preview mode have printing disabled

Example: If your Excel contains `Medical_Evidence/Doctor_Report.pdf`, the system will:
- Create a preview page at `/__preview/Medical_Evidence/Doctor_Report.pdf`
- Generate a clickable link in your dashboard
- Protect access with authentication
- Display the PDF in sandboxed preview mode

## What Happens Without PDF Links?

If you include a row with **no file path**, it will still appear in your data JSON, but:
- It won't have a clickable link
- It won't generate a preview page
- It's just stored as data without supporting evidence

This is fine for note-taking or metadata, but the PDF links are what make this system powerful for legal evidence management.
