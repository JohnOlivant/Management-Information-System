-- Read-only access for the MIS to Scheduling (database rule29_scheduler). Run as postgres after the role exists.
-- Hours by job reads job plans, handovers and job numbers. Crew capacity also reads workers' names and
-- titles, assignments, time away (not its notes) and approved leave. Emails and notes are not readable.
GRANT CONNECT ON DATABASE :"DBNAME" TO rule29_mis_reader;
GRANT USAGE ON SCHEMA scheduling, integration TO rule29_mis_reader;
GRANT SELECT ON scheduling.job_plans, scheduling.handovers, scheduling.assignments, integration.jobs_v1, integration.approved_leave_v1 TO rule29_mis_reader;
GRANT SELECT (id, client_id, worker_id, kind, date_from, date_to) ON scheduling.unavailability TO rule29_mis_reader;
GRANT SELECT (id, client_id, first_name, last_name, job_title, active) ON integration.workers_v1 TO rule29_mis_reader;
