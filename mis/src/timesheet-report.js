'use strict';
// The Timesheets app's own report (timesheet-pilot production/reports.js), shown in the MIS for a
// whole firm: hours, subsistence, expenses and mileage over a date range, by worker, job, allocation
// code, activity, expense category and approval status, with the same CSV downloads. summarise() and
// csv() are kept the same as in Timesheets, so the two always agree; keep them in step.

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const need = (ok, status, message) => { if (!ok) throw new HttpError(status, message); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 50000;

/** Checks the filters from the page: from, to, approval (all, approved, pending), workerId, jobId. */
function filters(params) {
  const f = {from: params.get('from'), to: params.get('to'), approval: params.get('approval') || 'all',
    workerId: params.get('workerId') || null, jobId: params.get('jobId') || null};
  need(DATE.test(f.from || '') && DATE.test(f.to || '') && f.from <= f.to, 400, 'Choose a valid report date range.');
  need(['all', 'approved', 'pending'].includes(f.approval), 400, 'Choose a valid approval filter.');
  need(!f.workerId || UUID.test(f.workerId), 400, 'Invalid worker filter.');
  need(!f.jobId || UUID.test(f.jobId), 400, 'Invalid job filter.');
  return f;
}

/** The workers, jobs and pay periods to choose from. */
async function reference(pool, clientId) {
  const q = (sql) => pool.query(sql, [clientId]).then(r => r.rows);
  const [workers, jobs, periods] = await Promise.all([
    q(`SELECT id, legacy_id AS reference, first_name||' '||last_name AS name, active FROM timesheet.workers WHERE client_id=$1 ORDER BY first_name, last_name`),
    q(`SELECT id, legacy_id AS reference, name, active FROM timesheet.jobs WHERE client_id=$1 ORDER BY legacy_id`),
    q(`SELECT date_from::text, date_to::text, status FROM timesheet.pay_periods WHERE client_id=$1 ORDER BY date_from DESC`),
  ]);
  return {workers, jobs, periods};
}

/** Every time entry and claim line in range, as Timesheets reads them (all workers of the firm). */
async function lines(pool, clientId, f) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN READ ONLY');
    await db.query("SET LOCAL statement_timeout = '20s'");
    return (await db.query(`WITH scoped AS (
 SELECT s.id,s.worker_id,s.status,w.legacy_id AS worker_reference,w.first_name||' '||w.last_name AS worker_name,p.label AS period_label
 FROM timesheet.submissions s JOIN timesheet.workers w ON w.id=s.worker_id JOIN timesheet.pay_periods p ON p.id=s.period_id
 WHERE s.client_id=$1
 AND ($4='all' OR ($4='approved' AND s.status IN ('payroll_approved','exported')) OR ($4='pending' AND s.status NOT IN ('payroll_approved','exported')))
 AND ($5::uuid IS NULL OR s.worker_id=$5)
 ), lines AS (
 SELECT 'time' AS kind,e.id,e.submission_id,e.work_date AS date,e.job_id,
 jsonb_build_object('hours',e.hours,'break_minutes',e.break_minutes,'start',e.start_time,'finish',e.end_time,'notes',e.notes,'code_id',c.id,'code_reference',c.legacy_id,'code_label',c.label,'activity_id',a.id,'activity_label',a.label) AS values
 FROM timesheet.time_entries e JOIN scoped s ON s.id=e.submission_id JOIN timesheet.codes c ON c.id=e.code_id LEFT JOIN timesheet.activities a ON a.id=e.activity_id
 WHERE e.client_id=$1 AND e.work_date BETWEEN $2::date AND $3::date
 UNION ALL SELECT 'subsistence',c.id,c.submission_id,c.claim_date,c.job_id,
 jsonb_build_object('amount',c.amount,'notes',c.notes,'category_id',t.id,'category_reference',t.legacy_id,'category_label',t.label)
 FROM timesheet.subsistence_claims c JOIN scoped s ON s.id=c.submission_id JOIN timesheet.subsistence_types t ON t.id=c.type_id
 WHERE c.client_id=$1 AND c.status='ok' AND c.deleted_at IS NULL AND c.claim_date BETWEEN $2::date AND $3::date
 UNION ALL SELECT 'expense',e.id,e.submission_id,e.expense_date,e.job_id,
 jsonb_build_object('gross',e.gross,'vat',e.vat,'net',e.net,'miles',e.miles,'vehicle',e.vehicle,'supplier',e.supplier,'notes',e.description,'category_id',c.id,'category_reference',c.legacy_id,'category_label',c.label,'receipt',e.receipt_id IS NOT NULL,'no_receipt_reason',e.no_receipt_reason)
 FROM timesheet.expense_lines e JOIN scoped s ON s.id=e.submission_id JOIN timesheet.expense_categories c ON c.id=e.category_id
 WHERE e.client_id=$1 AND e.status='ok' AND e.deleted_at IS NULL AND e.expense_date BETWEEN $2::date AND $3::date
 ) SELECT l.kind,l.id,l.submission_id,l.date::text,l.job_id,l.values,s.worker_id,s.worker_reference,s.worker_name,s.status,s.period_label,j.legacy_id AS job_reference,j.name AS job_name,j.site
 FROM lines l JOIN scoped s ON s.id=l.submission_id LEFT JOIN timesheet.jobs j ON j.id=l.job_id
 WHERE ($6::uuid IS NULL OR l.job_id=$6) ORDER BY l.date,s.worker_name,l.kind,l.id LIMIT ${MAX_ROWS + 1}`,
    [clientId, f.from, f.to, f.approval, f.workerId, f.jobId])).rows;
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
  }
}

/** The report from its lines (rows), as Timesheets returns it. */
function build(rows, f, clientId) {
  need(rows.length <= MAX_ROWS, 413, 'This report has more than 50,000 lines. Narrow the date range or filters.');
  return {clientId, from: f.from, to: f.to, approval: f.approval, workerId: f.workerId, jobId: f.jobId, scope: 'All company records', ...summarise(rows), details: rows};
}

// ---- From here to the end: the same as timesheet-pilot production/reports.js ----
const metricKeys=['hours','subsistence','expenses','mileage','miles','vat','net'];
const metrics=()=>Object.fromEntries(metricKeys.map(k=>[k,0]));
function summarise(rows){const total=metrics(),workers=new Map(),jobs=new Map(),codes=new Map(),activities=new Map(),categories=new Map(),statuses=new Map();let without=0;
 const bucket=(map,id,labels)=>{if(!map.has(id))map.set(id,{id,...labels,...metrics()});return map.get(id);};
 for(const r of rows){const v=r.values,n=metrics();if(r.kind==='time')n.hours=Math.round(Number(v.hours)*100);if(r.kind==='subsistence')n.subsistence=Math.round(Number(v.amount)*100);if(r.kind==='expense'){for(const k of ['vat','net','miles'])n[k]=Math.round(Number(v[k]||0)*100);n.expenses=Math.round(Number(v.gross)*100);if(v.miles)n.mileage=n.expenses;}
 const targets=[total,bucket(workers,r.worker_id,{reference:r.worker_reference,name:r.worker_name}),bucket(jobs,r.job_id||'unassigned',{reference:r.job_reference||'',name:r.job_name||'Unassigned job',site:r.site||''}),bucket(statuses,r.status,{name:r.status})];
 if(r.kind==='time'){targets.push(bucket(codes,v.code_id,{reference:v.code_reference,name:v.code_label}),bucket(activities,v.activity_id||'none',{name:v.activity_label||'No activity recorded'}));if(!v.activity_id)without+=n.hours;}
 if(r.kind==='expense')targets.push(bucket(categories,v.category_id,{reference:v.category_reference,name:v.category_label}));
 for(const target of targets)for(const k of metricKeys)target[k]+=n[k];
 }
 const finish=obj=>({...obj,...Object.fromEntries(metricKeys.map(k=>[k,obj[k]/100]))});const groups=map=>[...map.values()].map(finish).sort((a,b)=>a.name.localeCompare(b.name));
 return {totals:finish(total),workerCount:workers.size,lineCount:rows.length,hoursWithoutActivity:without/100,byWorker:groups(workers),byJob:groups(jobs),byCode:groups(codes),byActivity:groups(activities),byExpenseCategory:groups(categories),byStatus:groups(statuses)};
}
function cell(value){let s=String(value??'');if(typeof value==='string'&&/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function csv(report,view){need(['workers','jobs','codes','activities','categories','statuses','detail'].includes(view),400,'Choose a valid CSV report.');
 let headers,rows;
 if(view==='detail'){headers=['Company ID','Date','Type','Worker reference','Worker','Job reference','Job','Site','Week','Approval status','Allocation code','Allocation label','Activity','Claim category','Category label','Hours','Break minutes','Subsistence GBP','Expense gross GBP','VAT GBP','Expense net GBP','Miles','Vehicle','Supplier','Notes','Receipt attached','Missing receipt reason','Submission ID','Line ID'];rows=report.details.map(r=>{const v=r.values;return [report.clientId,r.date,r.kind,r.worker_reference,r.worker_name,r.job_reference,r.job_name,r.site,r.period_label,r.status,v.code_reference,v.code_label,v.activity_label,v.category_reference,v.category_label,v.hours??'',v.break_minutes??'',r.kind==='subsistence'?Number(v.amount).toFixed(2):'',r.kind==='expense'?Number(v.gross).toFixed(2):'',r.kind==='expense'?Number(v.vat).toFixed(2):'',r.kind==='expense'?Number(v.net).toFixed(2):'',v.miles??'',v.vehicle,v.supplier,v.notes,v.receipt==null?'':v.receipt?'Yes':'No',v.no_receipt_reason,r.submission_id,r.id];});}
 else{const key={workers:'byWorker',jobs:'byJob',codes:'byCode',activities:'byActivity',categories:'byExpenseCategory',statuses:'byStatus'}[view];headers=['Company ID','From','To','Approval filter','Access scope','Reference','Name','Site','Hours','Subsistence GBP','Expenses incl mileage GBP','Mileage GBP','Miles','VAT GBP','Expense net GBP'];rows=report[key].map(r=>[report.clientId,report.from,report.to,report.approval,report.scope,r.reference||'',r.name,r.site||'',...metricKeys.map(k=>r[k].toFixed(2))]);}
 return '\uFEFF'+[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}

module.exports = {filters, reference, lines, build, summarise, csv, HttpError};
