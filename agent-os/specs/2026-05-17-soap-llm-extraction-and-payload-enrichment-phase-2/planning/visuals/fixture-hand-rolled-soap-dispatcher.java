// fixture -- derived from public reference examples (Spring Classic / Servlet 2.5 era).
//
// This file represents the SHAPE of code the Phase 1 deterministic SOAP scanner
// CANNOT extract from: a hand-rolled SOAP dispatcher servlet with NO
// `@Endpoint`, NO `@WebService`, and NO `.wsdl` artifact -- only manual
// envelope parsing inside a plain `HttpServlet` `doPost`. This is the user's
// reference-service scenario that Phase 2's `propose_endpoints_from_code`
// tool exists to handle.
//
// Provenance note: hand-written for this test fixture from public reference
// examples (the pattern is common enough that no single source applies). No
// proprietary or user code is included.
//
// Two operations are exposed so the LLM extractor has multiple candidates:
//   - getAccount    (SOAPAction: "urn:CustomerAccount/getAccount")
//   - createOrder   (SOAPAction: "urn:CustomerAccount/createOrder")
//
// Optional third recogniser: a fallback branch parsing the body root element
// name when SOAPAction is missing.

package com.example.legacy.soap;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.StringReader;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.xml.bind.JAXBContext;
import javax.xml.bind.JAXBException;
import javax.xml.bind.Unmarshaller;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import com.example.legacy.soap.dto.GetAccountRequest;
import com.example.legacy.soap.dto.GetAccountResponse;
import com.example.legacy.soap.dto.CreateOrderRequest;
import com.example.legacy.soap.dto.CreateOrderResponse;

/**
 * Hand-rolled SOAP dispatcher servlet. NO Spring-WS @Endpoint, NO JAX-WS
 * @WebService, NO published WSDL. The framework scanner cannot find any
 * operation here -- there is no annotation, no JAX-WS port interface, and no
 * wsdl4j-parseable artefact on disk.
 */
public class CustomerAccountDispatcherServlet extends HttpServlet {

    private static final long serialVersionUID = 1L;
    private static final String NS = "http://example.com/customer-account/v1";

    private JAXBContext jaxbContext;

    @Override
    public void init() throws ServletException {
        try {
            this.jaxbContext = JAXBContext.newInstance(
                    GetAccountRequest.class,
                    GetAccountResponse.class,
                    CreateOrderRequest.class,
                    CreateOrderResponse.class);
        } catch (JAXBException e) {
            throw new ServletException("JAXB init failed", e);
        }
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {
        // Read the entire envelope body up-front -- legacy code did this with
        // a tiny copy loop; modern code typically uses commons-io. Either way,
        // no annotations are involved.
        String envelopeXml = readBody(req);

        String soapAction = stripQuotes(req.getHeader("SOAPAction"));

        try {
            if (soapAction != null && soapAction.endsWith("/getAccount")) {
                handleGetAccount(envelopeXml, resp);
                return;
            }
            if (soapAction != null && soapAction.endsWith("/createOrder")) {
                handleCreateOrder(envelopeXml, resp);
                return;
            }

            // Fallback: dispatch based on the SOAP body's root element name
            // when the SOAPAction header is missing (some legacy clients omit
            // it entirely).
            String bodyRoot = parseBodyRootElementName(envelopeXml);
            if ("GetAccountRequest".equals(bodyRoot)) {
                handleGetAccount(envelopeXml, resp);
                return;
            }
            if ("CreateOrderRequest".equals(bodyRoot)) {
                handleCreateOrder(envelopeXml, resp);
                return;
            }

            resp.sendError(HttpServletResponse.SC_BAD_REQUEST,
                    "Unrecognised SOAP operation");
        } catch (Exception e) {
            throw new ServletException("Dispatch failed", e);
        }
    }

    /**
     * Handler for the {@code getAccount} operation. The SOAPAction header
     * matches {@code urn:CustomerAccount/getAccount} and the body unmarshals
     * to {@link GetAccountRequest}.
     */
    private void handleGetAccount(String envelopeXml, HttpServletResponse resp)
            throws Exception {
        Unmarshaller u = jaxbContext.createUnmarshaller();
        GetAccountRequest request = (GetAccountRequest) u.unmarshal(
                new StringReader(extractBodyPayload(envelopeXml)));

        GetAccountResponse response = new GetAccountResponse();
        response.setAccountId(request.getAccountId());
        response.setHolderName("Example Holder");
        response.setBalance(1234.56);

        writeEnvelope(resp, response);
    }

    /**
     * Handler for the {@code createOrder} operation. SOAPAction
     * {@code urn:CustomerAccount/createOrder}. Body unmarshals to
     * {@link CreateOrderRequest}.
     */
    private void handleCreateOrder(String envelopeXml, HttpServletResponse resp)
            throws Exception {
        Unmarshaller u = jaxbContext.createUnmarshaller();
        CreateOrderRequest request = (CreateOrderRequest) u.unmarshal(
                new StringReader(extractBodyPayload(envelopeXml)));

        CreateOrderResponse response = new CreateOrderResponse();
        response.setOrderId("ORD-" + System.currentTimeMillis());
        response.setAccountId(request.getAccountId());
        response.setStatus("ACCEPTED");

        writeEnvelope(resp, response);
    }

    // -----------------------------------------------------------------------
    // Helpers -- nothing here is operation-specific; the operations live in
    // the two `handle*` methods above.
    // -----------------------------------------------------------------------

    private static String readBody(HttpServletRequest req) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = req.getReader()) {
            String line;
            while ((line = r.readLine()) != null) {
                sb.append(line).append('\n');
            }
        }
        return sb.toString();
    }

    private static String stripQuotes(String s) {
        if (s == null) return null;
        s = s.trim();
        if (s.length() >= 2 && s.charAt(0) == '"' && s.charAt(s.length() - 1) == '"') {
            return s.substring(1, s.length() - 1);
        }
        return s;
    }

    private static String parseBodyRootElementName(String envelopeXml) throws Exception {
        DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
        dbf.setNamespaceAware(true);
        DocumentBuilder db = dbf.newDocumentBuilder();
        Document doc = db.parse(new InputSource(new StringReader(envelopeXml)));
        NodeList bodies = doc.getElementsByTagNameNS(
                "http://schemas.xmlsoap.org/soap/envelope/", "Body");
        if (bodies.getLength() == 0) return null;
        Element body = (Element) bodies.item(0);
        NodeList kids = body.getChildNodes();
        for (int i = 0; i < kids.getLength(); i++) {
            if (kids.item(i) instanceof Element) {
                return ((Element) kids.item(i)).getLocalName();
            }
        }
        return null;
    }

    private static String extractBodyPayload(String envelopeXml) {
        // Naive: legacy code often did this with a substring + indexOf rather
        // than a real XML parse. Production code should use a proper Body
        // extractor; this fixture preserves the shape of the legacy pattern.
        int bodyOpen = envelopeXml.indexOf(":Body");
        int firstChildStart = envelopeXml.indexOf('<', envelopeXml.indexOf('>', bodyOpen));
        int bodyClose = envelopeXml.lastIndexOf("</");
        return envelopeXml.substring(firstChildStart, bodyClose);
    }

    private void writeEnvelope(HttpServletResponse resp, Object payload) throws Exception {
        resp.setContentType("text/xml; charset=utf-8");
        java.io.StringWriter sw = new java.io.StringWriter();
        jaxbContext.createMarshaller().marshal(payload, sw);
        String envelope =
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
                "<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\">" +
                "<soapenv:Body>" + sw.toString() + "</soapenv:Body>" +
                "</soapenv:Envelope>";
        resp.getWriter().write(envelope);
        resp.getWriter().flush();
    }
}
