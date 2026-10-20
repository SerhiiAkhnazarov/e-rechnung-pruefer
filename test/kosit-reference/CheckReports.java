/*
 * CheckReports.java — the "check-reports" macro of validator-configuration-xrechnung/build.xml
 * (lines 167-211): every *-report.xml must be schema-valid against resources/xsd/report.xsd (+
 * scenarios.xsd) — Ant <schemavalidate fullchecking="yes">; the Schematron part (report.sch) is
 * run by run.sh with the compiled report.xsl and check-svrl.xsl.
 *
 * Usage: java -cp <classes> CheckReports <report.xsd> <scenarios.xsd> <report-dir>...
 * Exit code 1 when a report is invalid or no report was found.
 */
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

import javax.xml.XMLConstants;
import javax.xml.transform.Source;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import javax.xml.validation.Validator;

import org.xml.sax.ErrorHandler;
import org.xml.sax.SAXParseException;

public class CheckReports {
    public static void main(final String[] args) throws Exception {
        final SchemaFactory sf = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
        sf.setFeature("http://apache.org/xml/features/validation/schema-full-checking", true);
        final Schema schema = sf.newSchema(new Source[] { new StreamSource(new File(args[1])), new StreamSource(new File(args[0])) });
        int files = 0, invalid = 0;
        for (int i = 2; i < args.length; i++) {
            final Path dir = Paths.get(args[i]);
            final List<Path> reports = new ArrayList<>();
            try (var s = Files.list(dir)) { s.filter(p -> p.getFileName().toString().endsWith("-report.xml")).sorted().forEach(reports::add); }
            for (final Path r : reports) {
                files++;
                final List<String> errors = new ArrayList<>();
                final Validator v = schema.newValidator();
                v.setErrorHandler(new ErrorHandler() {
                    public void warning(final SAXParseException e) { }
                    public void error(final SAXParseException e) { errors.add(e.getMessage()); }
                    public void fatalError(final SAXParseException e) { errors.add(e.getMessage()); }
                });
                try { v.validate(new StreamSource(r.toFile())); } catch (final Exception e) { errors.add(e.getMessage()); }
                if (!errors.isEmpty()) { invalid++; System.out.println("INVALID " + r + ": " + errors.get(0)); }
            }
        }
        System.out.println("report.xsd: " + files + " reports checked, " + invalid + " invalid");
        System.exit(files == 0 || invalid > 0 ? 1 : 0);
    }
}
