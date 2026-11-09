-- Read-only access for the MIS to Quoting (database sands_quoting). Run as postgres after the role exists.
-- Quoting's row security still applies: the MIS sets quoting.company_id to the firm it is reading.
GRANT CONNECT ON DATABASE :"DBNAME" TO rule29_mis_reader;
GRANT USAGE ON SCHEMA quoting TO rule29_mis_reader;
GRANT EXECUTE ON FUNCTION quoting.current_company() TO rule29_mis_reader;
GRANT SELECT ON quoting.estimates, quoting.proposals, quoting.customers, quoting.lead_sources, quoting.payment_stages TO rule29_mis_reader;
