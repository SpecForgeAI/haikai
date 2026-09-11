-- Bulk load: Ledger.Postings (table 4 of 4, FK-topological order)
-- Phase 2 of 5 — run AFTER the structural changesets, BEFORE foreign keys / indexes / reseed.
-- Identity columns (PostingID): source values are PRESERVED. COPY writes identity columns directly; if you load via INSERT instead, use INSERT ... OVERRIDING SYSTEM VALUE to keep the source ids (the columns are GENERATED ALWAYS AS IDENTITY on the target).
-- This pack documents the extract -> COPY pipe; it does NOT execute it.
-- Source-side extract tool: bcp (queryout, -c -t, -r\n) or sqlcmd -W -s, — bcp is the bulk path; sqlcmd is fine for small tables.

-- 1) SQL Server extract (run against the source; casts aligned to the type mapping):
SELECT
    PostingID,
    PostedBy,
    CAST(IsVoided AS int) AS IsVoided /* 0/1 -> boolean */,
    CONVERT(nvarchar(max), PayloadDocument) AS PayloadDocument,
    LooseValue,
    OrgNode.ToString() AS OrgNode /* '/1/2/' path form -> ltree '1.2' */,
    SiteShape.STAsText() AS SiteShape, SiteShape.STSrid AS SiteShape_srid /* load with ST_GeomFromText(SiteShape, SiteShape_srid) */,
    '\x' + LOWER(CONVERT(varchar(max), ScannedDocument, 2)) AS ScannedDocument /* bytea hex form: matches the AMVS wire ('\x' + lowercase hex) */,
    LOWER(CONVERT(char(36), RowGuid)) AS RowGuid,
    CONVERT(varchar(27), PostedOn, 121) AS PostedOn,
    CONVERT(varchar(34), PostedOffset, 127) AS PostedOffset,
    CONVERT(numeric(19,4), Amount) AS Amount,
    ShortCode,
    DisplayName,
    RowVersion,
    Tier
FROM Ledger.Postings;
-- cast note [PostedBy]: nvarchar(n) -> varchar(n): UTF-16 source characters load as UTF-8 (declared width is in CHARACTERS on both sides)
-- cast note [IsVoided]: bit -> boolean: extract with CAST(<col> AS int); 0/1 are valid Postgres boolean literals
-- cast note [PayloadDocument]: xml -> xml: extract with CONVERT(nvarchar(max), <col>). The SQL Server XML METHODS (.value/.query/.nodes/.exist/.modify) and XML SCHEMA COLLECTIONs have no target equivalent — routines using them are queued as xml_method rewrite sites.
-- cast note [LooseValue]: sql_variant -> jsonb: load form {"type": <base type>, "value": <text>}
-- cast note [OrgNode]: hierarchyid -> ltree: extract with <col>.ToString() ('/1/2/'); '/'-paths convert to '.'-labels
-- cast note [SiteShape]: geometry -> PostGIS geometry: extract as WKT (<col>.STAsText()) with the SRID (<col>.STSrid); load with ST_GeomFromText(wkt, srid)
-- cast note [ScannedDocument]: varbinary -> bytea: extract as '\x' + LOWER(CONVERT(varchar(max), <col>, 2)) (the Postgres bytea hex text form)
-- cast note [RowGuid]: uniqueidentifier -> uuid: extract with LOWER(CONVERT(char(36), <col>)) (Postgres renders uuid lowercase)
-- cast note [PostedOn]: datetime2(7) -> timestamp(6) without time zone; extract with CONVERT(varchar(27), <col>, 121)
-- cast note [PostedOffset]: datetimeoffset(7) -> timestamptz(6): the value is an INSTANT (offset-normalised); extract with CONVERT(varchar(34), <col>, 127)
-- cast note [Amount]: money -> numeric(19,4): extract with CONVERT(numeric(19,4), <col>)
-- cast note [DisplayName]: nvarchar(max) -> text (unbounded on the target)
-- cast note [Tier]: tinyint -> smallint (Postgres has no unsigned 1-byte integer; the 0..255 domain still fits)

-- 2) PostgreSQL load (pipe the extract as CSV into):
COPY "Ledger"."Postings" ("PostingID", "PostedBy", "IsVoided", "PayloadDocument", "LooseValue", "OrgNode", "SiteShape", "ScannedDocument", "RowGuid", "PostedOn", "PostedOffset", "Amount", "ShortCode", "DisplayName", "RowVersion", "Tier") FROM STDIN WITH (FORMAT csv, NULL '\N');
