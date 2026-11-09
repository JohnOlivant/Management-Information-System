-- Read-only access for the MIS to Scheduling (database rule29_scheduler). Run as postgres after the role exists.
GRANT CONNECT ON DATABASE :"DBNAME" TO rule29_mis_reader;
GRANT USAGE ON SCHEMA scheduling, integration TO rule29_mis_reader;
GRANT SELECT ON scheduling.job_plans, scheduling.handovers, integration.jobs_v1 TO rule29_mis_reader;
