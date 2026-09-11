package com.example.dbsidecar.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.sql.SQLException;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Wire-value precision pins (SPEC-1 §1.4; wire contract v2 §3).
 *
 * <p>The shaping analysis found the sidecar rendering {@code Timestamp} with a
 * fixed {@code .SSS} pattern and {@code Time} to whole seconds. Against Sybase
 * ASE that is lossless -- ASE {@code datetime} has 1/300 s resolution -- but a
 * SQL Server {@code datetime2(7)} or {@code time(7)} carries 100 ns ticks, and
 * the old rendering would have DROPPED four digits per value with no error
 * anywhere: a data-parity run would then compare two "equal" values that are
 * not. These tests pin the new rendering on both sides of that line.</p>
 */
class WirePrecisionTest {

    // ----------------------------------------------------------------------
    // The Sybase rendering must be byte-for-byte what it always was.
    // ----------------------------------------------------------------------

    /**
     * Millisecond-resolution values render EXACTLY as the pre-SPEC-1
     * {@code .SSS} pattern did -- three digits, zeros included. This is the
     * regression gate for every Sybase value in the corpus.
     */
    @Test
    void millisecondValuesRenderExactlyAsBefore() throws SQLException {
        assertEquals("2026-03-29 02:30:00.997", DbQueryService.normalizeWireValue(
                java.sql.Timestamp.valueOf("2026-03-29 02:30:00.997")));
        // A trailing zero inside the millisecond field is KEPT (".120", not ".12").
        assertEquals("2026-01-01 00:00:00.120", DbQueryService.normalizeWireValue(
                java.sql.Timestamp.valueOf("2026-01-01 00:00:00.120")));
        // A whole second still renders three zeros, never a bare seconds value.
        assertEquals("2026-01-01 00:00:00.000", DbQueryService.normalizeWireValue(
                java.sql.Timestamp.valueOf("2026-01-01 00:00:00")));
        assertEquals("2026-01-01 00:00:00.100", DbQueryService.normalizeWireValue(
                java.sql.Timestamp.valueOf("2026-01-01 00:00:00.1")));
    }

    /** A whole-second {@code Time} renders with NO fraction, exactly as before. */
    @Test
    void wholeSecondTimeRendersWithoutFraction() throws SQLException {
        assertEquals("13:05:09",
                DbQueryService.normalizeWireValue(java.sql.Time.valueOf("13:05:09")));
    }

    // ----------------------------------------------------------------------
    // Sub-millisecond precision now survives.
    // ----------------------------------------------------------------------

    /**
     * A {@code datetime2(7)} value keeps all seven fractional digits. The
     * fraction is rendered from {@code getNanos()}, so the 100 ns tick
     * ({@code 100} nanoseconds) is the smallest unit that can appear.
     */
    @Test
    void datetime2SevenDigitFractionSurvives() throws SQLException {
        final java.sql.Timestamp ts = java.sql.Timestamp.valueOf("2026-06-01 12:34:56");
        ts.setNanos(123456700);
        assertEquals("2026-06-01 12:34:56.1234567", DbQueryService.normalizeWireValue(ts));

        final java.sql.Timestamp micro = java.sql.Timestamp.valueOf("2026-06-01 12:34:56");
        micro.setNanos(123456000);
        assertEquals("2026-06-01 12:34:56.123456", DbQueryService.normalizeWireValue(micro));

        final java.sql.Timestamp tick = java.sql.Timestamp.valueOf("2026-06-01 12:34:56");
        tick.setNanos(100);
        assertEquals("2026-06-01 12:34:56.0000001", DbQueryService.normalizeWireValue(tick));
    }

    /** The fraction renderer: trailing zeros trimmed, never below the minimum. */
    @Test
    void fractionRendering() {
        assertEquals(".000", DbQueryService.renderFraction(0, 3));
        assertEquals(".120", DbQueryService.renderFraction(120000000, 3));
        assertEquals(".1234567", DbQueryService.renderFraction(123456700, 3));
        assertEquals(".123456789", DbQueryService.renderFraction(123456789, 3));
        // minDigits 0: a zero fraction disappears entirely.
        assertEquals("", DbQueryService.renderFraction(0, 0));
        assertEquals(".5", DbQueryService.renderFraction(500000000, 0));
        // A negative nanosecond value cannot occur but must not blow up.
        assertEquals(".000", DbQueryService.renderFraction(-1, 3));
    }

    /** A {@code time(7)} read as {@link LocalTime} keeps its fraction. */
    @Test
    void timeFractionSurvivesViaLocalTime() {
        assertEquals("13:05:09",
                DbQueryService.renderWireTime(LocalTime.of(13, 5, 9)));
        assertEquals("13:05:09.1234567",
                DbQueryService.renderWireTime(LocalTime.of(13, 5, 9, 123456700)));
        assertEquals("00:00:00.500",
                DbQueryService.renderWireTime(LocalTime.of(0, 0, 0, 500000000)));
    }

    /** A {@code java.sql.Time} carrying milliseconds renders them. */
    @Test
    void millisecondTimeRendersItsFraction() throws SQLException {
        final java.sql.Time time = new java.sql.Time(
                java.sql.Time.valueOf("13:05:09").getTime() + 250L);
        assertEquals("13:05:09.250", DbQueryService.normalizeWireValue(time));
    }

    // ----------------------------------------------------------------------
    // datetimeoffset, uniqueidentifier, blob
    // ----------------------------------------------------------------------

    /**
     * {@code datetimeoffset} renders ISO with a FIXED seven-digit fraction and
     * an explicit numeric offset -- never a bare {@code Z}, which a naive
     * consumer could read as "no zone".
     */
    @Test
    void dateTimeOffsetRendersIsoWithExplicitOffset() throws SQLException {
        final OffsetDateTime value = OffsetDateTime.of(
                2026, 6, 1, 12, 34, 56, 123456700, ZoneOffset.ofHours(1));
        assertEquals("2026-06-01T12:34:56.1234567+01:00",
                DbQueryService.normalizeWireValue(
                        microsoft.sql.DateTimeOffset.valueOf(value)));
        // The plain java.time value takes the same path.
        assertEquals("2026-06-01T12:34:56.1234567+01:00",
                DbQueryService.normalizeWireValue(value));
    }

    /** UTC renders as {@code +00:00}, never {@code Z}. */
    @Test
    void dateTimeOffsetUtcRendersNumericZeroOffset() throws SQLException {
        final OffsetDateTime utc = OffsetDateTime.of(
                2026, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC);
        assertEquals("2026-01-01T00:00:00.0000000+00:00",
                DbQueryService.normalizeWireValue(utc));
    }

    /**
     * A GUID renders LOWER-case: mssql-jdbc hands {@code uniqueidentifier}
     * back upper-cased while Postgres renders {@code uuid} lower-cased, and a
     * parity run would otherwise flag every GUID column as different.
     */
    @Test
    void uuidRendersLowercase() throws SQLException {
        assertEquals("6f9619ff-8b86-d011-b42d-00c04fc964ff",
                DbQueryService.normalizeWireValue(
                        UUID.fromString("6F9619FF-8B86-D011-B42D-00C04FC964FF")));
        // The driver's String form is lower-cased only when the COLUMN is a
        // uniqueidentifier -- ordinary text is never touched.
        assertEquals("6f9619ff-8b86-d011-b42d-00c04fc964ff",
                DbQueryService.normalizeWireValue(
                        "6F9619FF-8B86-D011-B42D-00C04FC964FF", "uniqueidentifier"));
        assertEquals("MixedCase Business Value",
                DbQueryService.normalizeWireValue("MixedCase Business Value", "nvarchar"));
        assertEquals("6F9619FF-8B86-D011-B42D-00C04FC964FF",
                DbQueryService.normalizeWireValue(
                        "6F9619FF-8B86-D011-B42D-00C04FC964FF", null));
    }

    /** A {@link java.sql.Blob} renders as {@code \x} hex, same as {@code byte[]}. */
    @Test
    void blobRendersAsPostgresStyleHex() throws SQLException {
        assertEquals("\\xdeadbeef", DbQueryService.normalizeWireValue(
                new javax.sql.rowset.serial.SerialBlob(
                        new byte[] {(byte) 0xDE, (byte) 0xAD, (byte) 0xBE, (byte) 0xEF})));
        assertEquals("\\x", DbQueryService.normalizeWireValue(
                new javax.sql.rowset.serial.SerialBlob(new byte[0])));
    }

    /** Null stays null and the agreed pass-through shapes are untouched. */
    @Test
    void passThroughShapesAreUnchanged() throws SQLException {
        assertNull(DbQueryService.normalizeWireValue(null));
        assertEquals(42, DbQueryService.normalizeWireValue(42));
        assertEquals(Boolean.TRUE, DbQueryService.normalizeWireValue(Boolean.TRUE));
        assertEquals("plain", DbQueryService.normalizeWireValue("plain"));
    }

    // ----------------------------------------------------------------------
    // The inverse parsers stay lenient (the /call binder reads these back).
    // ----------------------------------------------------------------------

    /** A seven-digit fraction parses back without loss. */
    @Test
    void inverseParserAcceptsSevenDigitFractions() {
        final java.sql.Timestamp parsed =
                RoutineCallService.parseWireTimestamp("2026-06-01 12:34:56.1234567");
        assertEquals(123456700, parsed.getNanos());
        assertEquals("2026-06-01 12:34:56.1234567",
                parsed.toLocalDateTime().format(DbQueryService.WIRE_DATETIME_SECONDS)
                        + DbQueryService.renderFraction(parsed.getNanos(), 3));
    }

    /** The lenient datetime shapes a caller realistically produces still parse. */
    @Test
    void inverseParserStaysLenient() {
        assertEquals(java.sql.Timestamp.valueOf("2026-06-01 12:34:56"),
                RoutineCallService.parseWireTimestamp("2026-06-01T12:34:56"));
        assertEquals(java.sql.Timestamp.valueOf("2026-06-01 12:34:00"),
                RoutineCallService.parseWireTimestamp("2026-06-01 12:34"));
        assertEquals(java.sql.Timestamp.valueOf("2026-06-01 00:00:00"),
                RoutineCallService.parseWireTimestamp("2026-06-01"));
        assertEquals(java.sql.Timestamp.valueOf("2026-06-01 12:34:56"),
                RoutineCallService.parseWireTimestamp("2026-06-01 12:34:56Z"));
    }

    /** The ISO datetimeoffset wire form binds back to a zoned driver value. */
    @Test
    void dateTimeOffsetParsesBackFromTheWireForm() {
        final microsoft.sql.DateTimeOffset bound =
                RoutineCallService.parseWireDateTimeOffset("2026-06-01T12:34:56.1234567+01:00");
        assertEquals(60, bound.getMinutesOffset());
        assertEquals("2026-06-01T12:34:56.1234567+01:00",
                DbQueryService.renderWireOffsetDateTime(bound.getOffsetDateTime()));
        // A zone-less value is read as UTC -- the sidecar's own pinned zone --
        // rather than silently taking the JVM default.
        assertEquals(0,
                RoutineCallService.parseWireDateTimeOffset("2026-06-01 12:34:56.000")
                        .getMinutesOffset());
    }
}
