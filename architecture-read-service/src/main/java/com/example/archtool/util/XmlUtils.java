package com.example.archtool.util;

import com.example.archtool.exception.DiagramParsingException;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.StringReader;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Utility class for XML parsing operations used in diagram parsing.
 *
 * <p>Provides safe methods for parsing XML content and extracting
 * attribute values with proper error handling and HTML entity unescaping.</p>
 */
public final class XmlUtils {

    private static final Pattern NUMERIC_ENTITY_PATTERN = Pattern.compile("&#(\\d+);");

    private XmlUtils() {
        // Utility class - prevent instantiation
    }

    /**
     * Safely parses an XML string to a DOM Document.
     *
     * @param xmlContent the XML content as a string
     * @param source     identifier for error messages
     * @return the parsed Document
     * @throws DiagramParsingException if the XML is invalid or cannot be parsed
     */
    public static Document parseXmlString(String xmlContent, String source) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            // Disable external entities for security
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);

            DocumentBuilder builder = factory.newDocumentBuilder();
            InputSource inputSource = new InputSource(new StringReader(xmlContent));
            return builder.parse(inputSource);
        } catch (ParserConfigurationException | SAXException | IOException e) {
            throw new DiagramParsingException(source, "Invalid XML: " + e.getMessage(), e);
        }
    }

    /**
     * Safely parses XML bytes to a DOM Document.
     *
     * @param xmlBytes the XML content as bytes
     * @param source   identifier for error messages
     * @return the parsed Document
     * @throws DiagramParsingException if the XML is invalid or cannot be parsed
     */
    public static Document parseXmlBytes(byte[] xmlBytes, String source) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            // Disable external entities for security
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);

            DocumentBuilder builder = factory.newDocumentBuilder();
            return builder.parse(new ByteArrayInputStream(xmlBytes));
        } catch (ParserConfigurationException | SAXException | IOException e) {
            throw new DiagramParsingException(source, "Invalid XML: " + e.getMessage(), e);
        }
    }

    /**
     * Extracts an attribute value from an element, returning a default if not present.
     *
     * @param element      the XML element
     * @param attributeName the name of the attribute to extract
     * @param defaultValue the default value if attribute is not present or empty
     * @return the attribute value or the default
     */
    public static String getAttribute(Element element, String attributeName, String defaultValue) {
        if (element == null || !element.hasAttribute(attributeName)) {
            return defaultValue;
        }
        String value = element.getAttribute(attributeName);
        return (value == null || value.isEmpty()) ? defaultValue : value;
    }

    /**
     * Extracts an attribute value from an element, returning null if not present.
     *
     * @param element      the XML element
     * @param attributeName the name of the attribute to extract
     * @return the attribute value or null
     */
    public static String getAttribute(Element element, String attributeName) {
        return getAttribute(element, attributeName, null);
    }

    /**
     * Extracts a Double attribute value from an element, returning null if not present or invalid.
     *
     * @param element       the XML element
     * @param attributeName the name of the attribute to extract
     * @return the Double value or null
     */
    public static Double getDoubleAttribute(Element element, String attributeName) {
        String value = getAttribute(element, attributeName);
        if (value == null || value.isEmpty()) {
            return null;
        }
        try {
            return Double.parseDouble(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * Extracts a boolean attribute value from an element.
     *
     * <p>Returns true if the attribute equals "1" or "true" (case-insensitive),
     * false otherwise.</p>
     *
     * @param element       the XML element
     * @param attributeName the name of the attribute to extract
     * @return true if attribute indicates true, false otherwise
     */
    public static boolean getBooleanAttribute(Element element, String attributeName) {
        String value = getAttribute(element, attributeName);
        if (value == null) {
            return false;
        }
        return "1".equals(value) || "true".equalsIgnoreCase(value);
    }

    /**
     * Unescapes HTML entities from a label string.
     *
     * <p>Common HTML entities in draw.io labels:</p>
     * <ul>
     *   <li>&amp;amp; -&gt; &amp;</li>
     *   <li>&amp;lt; -&gt; &lt;</li>
     *   <li>&amp;gt; -&gt; &gt;</li>
     *   <li>&amp;quot; -&gt; "</li>
     *   <li>&amp;apos; -&gt; '</li>
     *   <li>&amp;nbsp; -&gt; (non-breaking space)</li>
     *   <li>&lt;br&gt; and &lt;br/&gt; -&gt; newline</li>
     * </ul>
     *
     * @param label the label string potentially containing HTML entities
     * @return the unescaped string, or null if input is null
     */
    public static String unescapeHtmlEntities(String label) {
        if (label == null) {
            return null;
        }

        String result = label;

        // Handle HTML break tags first (convert to newline or space)
        result = result.replaceAll("<br\\s*/?>", "\n");
        result = result.replaceAll("<BR\\s*/?>", "\n");

        // Strip other HTML tags (draw.io sometimes wraps text in divs, spans, etc.)
        result = result.replaceAll("<[^>]+>", "");

        // Unescape common HTML entities
        result = result.replace("&amp;", "&");
        result = result.replace("&lt;", "<");
        result = result.replace("&gt;", ">");
        result = result.replace("&quot;", "\"");
        result = result.replace("&apos;", "'");
        result = result.replace("&#39;", "'");
        result = result.replace("&nbsp;", " ");
        result = result.replace("&#160;", " ");

        // Handle numeric entities (basic support)
        result = replaceNumericEntities(result);

        return result.trim();
    }

    /**
     * Replaces numeric HTML entities (e.g., &#65;) with their character equivalents.
     */
    private static String replaceNumericEntities(String input) {
        Matcher matcher = NUMERIC_ENTITY_PATTERN.matcher(input);
        StringBuilder sb = new StringBuilder();

        while (matcher.find()) {
            try {
                int codePoint = Integer.parseInt(matcher.group(1));
                matcher.appendReplacement(sb, String.valueOf((char) codePoint));
            } catch (NumberFormatException e) {
                // Keep original if parsing fails
                matcher.appendReplacement(sb, Matcher.quoteReplacement(matcher.group(0)));
            }
        }
        matcher.appendTail(sb);

        return sb.toString();
    }
}
