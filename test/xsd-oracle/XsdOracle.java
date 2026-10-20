/*
 * XsdOracle.java — reference XML Schema validation with the JDK's built-in Xerces
 * (javax.xml.validation, W3C XML Schema 1.0).
 *
 * For every *.xml file below the given directories (or every file given directly) the root
 * element's namespace selects the root schema:
 *   urn:oasis:names:specification:ubl:schema:xsd:Invoice-2        -> UBL-Invoice-2.1.xsd
 *   urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2     -> UBL-CreditNote-2.1.xsd
 *   urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100  -> CrossIndustryInvoice_100pD16B.xsd
 *   anything else                                                 -> UBL-Invoice-2.1.xsd (the
 *   document is then necessarily invalid: cvc-elt.1.a — the same rule is applied by
 *   test/run-xsd-tests.cjs so that both sides compare the same thing)
 *
 * One JSON object per line is written to the output file:
 *   { "file": "<path>", "schema": "<id>", "valid": true|false,
 *     "errors": [ { "line": n, "column": n, "severity": "error|fatal|warning", "message": "..." } ] }
 *
 * The schema objects are built once with SchemaFactory (grammar-pool-only mode, i.e. exactly the
 * behaviour of a Schema created from explicit sources: xsi:schemaLocation hints are not followed).
 * External DTDs are not loaded. Warnings are recorded but do not affect the verdict (as in Xerces,
 * only error() and fatalError() make a document invalid).
 *
 * Usage:
 *   java -cp test/xsd-oracle XsdOracle <UBL-Invoice-2.1.xsd> <UBL-CreditNote-2.1.xsd> \
 *        <CrossIndustryInvoice_100pD16B.xsd> <out.jsonl> <dir-or-file>...
 *   java -cp test/xsd-oracle XsdOracle --schema <any.xsd> <out.jsonl> <dir-or-file>...
 *        (single-schema mode: every document is validated against that one schema; used by
 *        test/xsd-selftest.cjs for the feature self-test schema)
 *
 * Note: JAVA_TOOL_OPTIONS in this environment prints a "Picked up ..." line on stderr; harmless.
 */
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Stream;

import javax.xml.XMLConstants;
import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamReader;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import javax.xml.validation.Validator;

import org.xml.sax.ErrorHandler;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;

public class XsdOracle {

    static final String NS_UBL_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
    static final String NS_UBL_CREDITNOTE = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2";
    static final String NS_CII = "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100";
    static boolean singleSchema = false;

    static final class Finding {
        final String severity; final int line; final int column; final String message;
        Finding(String severity, SAXParseException e) {
            this.severity = severity; this.line = e.getLineNumber(); this.column = e.getColumnNumber();
            this.message = e.getMessage() == null ? "" : e.getMessage();
        }
        Finding(String severity, String message) {
            this.severity = severity; this.line = -1; this.column = -1; this.message = message;
        }
    }

    static final class Collector implements ErrorHandler {
        final List<Finding> findings = new ArrayList<>();
        public void warning(SAXParseException e) { findings.add(new Finding("warning", e)); }
        public void error(SAXParseException e) { findings.add(new Finding("error", e)); }
        public void fatalError(SAXParseException e) throws SAXException { findings.add(new Finding("fatal", e)); throw e; }
        boolean invalid() { for (Finding f : findings) if (!f.severity.equals("warning")) return true; return false; }
    }

    static Schema load(SchemaFactory sf, String file) throws SAXException {
        return sf.newSchema(new File(file));
    }

    /** Namespace of the document element, or null when the document cannot be parsed up to it. */
    static String rootNamespace(File f, XMLInputFactory xif) {
        try (InputStream in = new FileInputStream(f)) {
            XMLStreamReader r = xif.createXMLStreamReader(in);
            try {
                while (r.hasNext()) {
                    int ev = r.next();
                    if (ev == XMLStreamConstants.START_ELEMENT) {
                        String ns = r.getNamespaceURI();
                        return ns == null ? "" : ns;
                    }
                }
            } finally { r.close(); }
        } catch (Exception e) {
            return null;
        }
        return null;
    }

    static String json(String s) {
        StringBuilder b = new StringBuilder(s.length() + 8);
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    public static void main(String[] args) throws Exception {
        if (args.length >= 4 && args[0].equals("--schema")) {
            String[] a = new String[args.length + 1];
            a[0] = args[1]; a[1] = args[1]; a[2] = args[1];
            System.arraycopy(args, 2, a, 3, args.length - 2);
            args = a;
            singleSchema = true;
        }
        if (args.length < 5) {
            System.err.println("usage: XsdOracle <UBL-Invoice.xsd> <UBL-CreditNote.xsd> <CII.xsd> <out.jsonl> <dir-or-file>...");
            System.exit(2);
        }
        SchemaFactory sf = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
        sf.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        sf.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "file");
        System.err.println("SchemaFactory: " + sf.getClass().getName());
        long t0 = System.nanoTime();
        Schema ublInvoice = load(sf, args[0]);
        Schema ublCreditNote = load(sf, args[1]);
        Schema cii = load(sf, args[2]);
        System.err.println("schemas loaded in " + (System.nanoTime() - t0) / 1_000_000 + " ms");

        XMLInputFactory xif = XMLInputFactory.newInstance();
        xif.setProperty(XMLInputFactory.SUPPORT_DTD, Boolean.FALSE);
        xif.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, Boolean.FALSE);

        List<File> files = new ArrayList<>();
        for (int i = 4; i < args.length; i++) {
            File f = new File(args[i]);
            if (f.isDirectory()) {
                try (Stream<Path> s = Files.walk(f.toPath())) {
                    s.filter(p -> Files.isRegularFile(p) && p.toString().toLowerCase().endsWith(".xml"))
                     .sorted().forEach(p -> files.add(p.toFile()));
                }
            } else if (f.isFile()) {
                files.add(f);
            } else {
                System.err.println("warning: not found: " + f);
            }
        }
        Collections.sort(files);

        int nValid = 0, nInvalid = 0;
        long tv = 0;
        try (PrintWriter out = new PrintWriter(Files.newBufferedWriter(Path.of(args[3]), StandardCharsets.UTF_8))) {
            for (File f : files) {
                String ns = rootNamespace(f, xif);
                Schema schema; String schemaId;
                if (singleSchema) { schema = ublInvoice; schemaId = "single"; }
                else if (NS_UBL_CREDITNOTE.equals(ns)) { schema = ublCreditNote; schemaId = "UBL-CreditNote-2.1"; }
                else if (NS_CII.equals(ns)) { schema = cii; schemaId = "CII-D16B"; }
                else { schema = ublInvoice; schemaId = "UBL-Invoice-2.1"; }
                Collector c = new Collector();
                long s0 = System.nanoTime();
                try {
                    Validator v = schema.newValidator();
                    v.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
                    v.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
                    v.setErrorHandler(c);
                    v.validate(new StreamSource(f));
                } catch (SAXParseException e) {
                    boolean seen = false;
                    for (Finding fi : c.findings) if (fi.line == e.getLineNumber() && fi.message.equals(e.getMessage())) seen = true;
                    if (!seen) c.findings.add(new Finding("fatal", e));
                } catch (SAXException | IOException e) {
                    c.findings.add(new Finding("fatal", String.valueOf(e.getMessage())));
                }
                tv += System.nanoTime() - s0;
                boolean valid = !c.invalid();
                if (valid) nValid++; else nInvalid++;
                StringBuilder b = new StringBuilder();
                b.append("{\"file\":").append(json(f.getPath()))
                 .append(",\"schema\":").append(json(schemaId))
                 .append(",\"rootNamespace\":").append(ns == null ? "null" : json(ns))
                 .append(",\"valid\":").append(valid)
                 .append(",\"errors\":[");
                boolean first = true;
                for (Finding fi : c.findings) {
                    if (!first) b.append(',');
                    first = false;
                    b.append("{\"severity\":").append(json(fi.severity))
                     .append(",\"line\":").append(fi.line)
                     .append(",\"column\":").append(fi.column)
                     .append(",\"message\":").append(json(fi.message)).append('}');
                }
                b.append("]}");
                out.println(b);
            }
        }
        System.err.println("files: " + files.size() + "  valid: " + nValid + "  invalid: " + nInvalid
            + "  validation time: " + tv / 1_000_000 + " ms");
    }
}
