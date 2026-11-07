// Bank bulk-upload file builders for a payment run.
//
// The bank layouts follow the bank's own publicly published format document:
// - Union Bank of India, "NEFT/RTGS File Upload in TEXT Format":
//   https://www.unionbankonline.bank.in/InternetBankingProductDemos/Sample%20NEFT%20Format_txt%20File.pdf
// - Union Bank of India, "SALARY File Upload in CSV Format":
//   https://www.unionbankonline.bank.in/InternetBankingProductDemos/Sample%20Salary%20Format_CSV%20File.pdf
// The 'generic' layout is a labelled assumption kept from the first prototype;
// it is not any bank's format.
//
// Demo deployment honesty: the FPC's own corporate ID, debit account and
// remitter branch details are synthetic demo configuration (env vars below),
// and the seeded farmer registry stores masked account numbers only, so a
// generated file is demo-shaped and cannot be uploaded to a real bank as-is.

export interface PaymentFileItem {
  name: string;
  account: string;
  ifsc: string;
  amountPaisa: number;
  slip: string;
}

export interface PaymentFileInput {
  runId: number;
  runDate: string;
  items: PaymentFileItem[];
}

export interface BuiltFile {
  body: string;
  filename: string;
  contentType: string;
}

export const PAYMENT_FILE_FORMATS = ['unionbank-neft', 'unionbank-salary', 'generic'] as const;

const env = (k: string, d: string) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : d;
};

// Synthetic demo values for the FPC's own bank details; a real deployment sets
// these from the FPC's actual corporate-banking registration.
const corporateId = () => env('FPC_BANK_CORPORATE_ID', 'FPCDEMO');
const debitAccount = () => env('FPC_BANK_DEBIT_ACCOUNT', '000000000DEMO');
const remitterIfsc = () => env('FPC_BANK_REMITTER_IFSC', 'UBIN0DEMO01');
const solId = () => env('FPC_BANK_SOL_ID', '00000');
const email = () => env('FPC_BANK_EMAIL', 'office@example.invalid');

// Union Bank's format doc forbids commas inside fields; pipe is the alternate
// separator, so strip both. Truncate to the documented field length.
const clean = (s: string, max: number) =>
  s.replace(/[,"|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || '-';

const rupees = (paisa: number) => (paisa / 100).toFixed(2);

function unionbankNeft(input: PaymentFileInput): BuiltFile {
  const lines = [
    // FILEHDR, CORPORATE_ID (max 32), File_Serial_Number (max 6), Encryption Y/N, Remarks (max 500)
    ['FILEHDR', clean(corporateId(), 32), String(input.runId).slice(0, 6), 'N', clean(`FPC payment run ${input.runDate}`, 500)].join(','),
  ];
  for (const it of input.items) {
    // NEFT, remitter branch IFSC, debit a/c, receiver IFSC, beneficiary a/c,
    // currency, amount, txn remarks (max 140), beneficiary name (max 40),
    // user email (max 80), remarks (max 20)
    lines.push(
      [
        'NEFT',
        clean(remitterIfsc(), 12),
        clean(debitAccount(), 24),
        clean(it.ifsc, 12),
        clean(it.account, 24),
        'INR',
        rupees(it.amountPaisa),
        clean(`FPC-${input.runDate}-${it.slip}`, 140),
        clean(it.name, 40),
        clean(email(), 80),
        clean(it.slip, 20),
      ].join(',')
    );
  }
  return {
    body: lines.join('\r\n'),
    filename: `payment-run-${input.runId}-unionbank-neft.txt`,
    contentType: 'text/plain; charset=utf-8',
  };
}

function unionbankSalary(input: PaymentFileInput): BuiltFile {
  const total = input.items.reduce((s, it) => s + it.amountPaisa, 0);
  const lines = [
    // Row 1: FILEHDR, CORPORATE_ID (max 32), File_Sequence_Number (max 6)
    ['FILEHDR', clean(corporateId(), 32), String(input.runId).slice(0, 6)].join(','),
    // Row 2: debit - branch SOL ID (5), debit a/c (max 15), currency, DR, total, remarks (max 13)
    [clean(solId(), 5), clean(debitAccount(), 15), 'INR', 'DR', rupees(total), clean(`FPC-${input.runDate}`, 13)].join(','),
  ];
  for (const it of input.items) {
    // Row 3+: credit - branch SOL ID, beneficiary a/c (max 15), INR, CR, amount, remarks (max 13)
    lines.push([clean(solId(), 5), clean(it.account, 15), 'INR', 'CR', rupees(it.amountPaisa), clean(it.slip, 13)].join(','));
  }
  return {
    body: lines.join('\r\n'),
    filename: `payment-run-${input.runId}-unionbank-salary.csv`,
    contentType: 'text/csv; charset=utf-8',
  };
}

function generic(input: PaymentFileInput): BuiltFile {
  // First-prototype layout. Labelled assumption, not a bank's format.
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ['Sr No,Beneficiary Name,Account Number,IFSC,Amount (Rs),Payment Ref,Value Date'];
  input.items.forEach((it, i) => {
    lines.push(
      [i + 1, esc(it.name), esc(it.account), esc(it.ifsc), rupees(it.amountPaisa), esc(`FPC-${input.runDate}-${it.slip}`), input.runDate].join(',')
    );
  });
  return {
    body: lines.join('\r\n'),
    filename: `payment-run-${input.runId}.csv`,
    contentType: 'text/csv; charset=utf-8',
  };
}

export function buildPaymentFile(format: string, input: PaymentFileInput): BuiltFile | null {
  switch (format) {
    case 'unionbank-neft':
      return unionbankNeft(input);
    case 'unionbank-salary':
      return unionbankSalary(input);
    case 'generic':
      return generic(input);
    default:
      return null;
  }
}
