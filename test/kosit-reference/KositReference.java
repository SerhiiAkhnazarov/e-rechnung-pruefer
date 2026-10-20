/*
 * KositReference.java — re-implementation of the processing pipeline of the KoSIT validator
 * (https://github.com/itplr-kosit/validator, tag v1.6.3 @ 37cddce2 = source of the release JAR 1.6.3)
 * with JDK 21 + Saxon HE only: an independent second reference beside the official JAR (suite
 * kosit-official), producing varl reports (http://www.xoev.de/de/validator/varl/1) of the XRechnung
 * configuration from its sources. Every step mirrors a class of the validator; the references in
 * the comments point to de/kosit/validationtool/**.java of the cloned source. See docs/KOSIT-REFERENCE.md.
 *
 * Usage (same option names as CommandLineOptions.java of the validator):
 *   java -cp <saxon-he.jar>:<saxon lib/*>:<classes> KositReference
 *        -s <scenarios.xml> [-r <repository-dir>] [-o <output-dir>] [-h|--html|--extract-html]
 *        [--serialize-report-input] [-c|--check-assertions <assertions.xml>]
 *        [--report-prefix <p>] [--report-postfix <p>] [-p|--print] [-l <level>] [-d] [-X] [-m]
 *        [--threads <n>] [--engine-name <name>] [--xsd-dir <dir with createReportInput.xsd>]
 *        <file.xml|dir> ...
 * Exit code (ReturnValue.java): 0 = all acceptable (or help), n>0 = number of rejected documents
 * (+ failed assertions), -1 = parsing error of the command line, -2 = configuration error.
 *
 * Licence: EUPL-1.2 (this file); the reproduced logic is Apache-2.0 (KoSIT).
 */
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.io.StringWriter;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.GregorianCalendar;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Collectors;

import javax.xml.XMLConstants;
import javax.xml.datatype.DatatypeFactory;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.Source;
import javax.xml.transform.SourceLocator;
import javax.xml.transform.TransformerException;
import javax.xml.transform.URIResolver;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import javax.xml.validation.Validator;

import org.w3c.dom.Attr;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NamedNodeMap;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.ErrorHandler;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;

import net.sf.saxon.lib.Feature;
import net.sf.saxon.lib.FeatureKeys;
import net.sf.saxon.s9api.DocumentBuilder;
import net.sf.saxon.s9api.MessageListener2;
import net.sf.saxon.s9api.Processor;
import net.sf.saxon.s9api.QName;
import net.sf.saxon.s9api.SaxonApiException;
import net.sf.saxon.s9api.Serializer;
import net.sf.saxon.s9api.XPathCompiler;
import net.sf.saxon.s9api.XPathExecutable;
import net.sf.saxon.s9api.XPathSelector;
import net.sf.saxon.s9api.XdmDestination;
import net.sf.saxon.s9api.XdmItem;
import net.sf.saxon.s9api.XdmNode;
import net.sf.saxon.s9api.XdmNodeKind;
import net.sf.saxon.s9api.XsltCompiler;
import net.sf.saxon.s9api.XsltExecutable;
import net.sf.saxon.s9api.XsltTransformer;

public class KositReference {

    // ----------------------------------------------------------------------------------------------
    // Constants of the validator
    // ----------------------------------------------------------------------------------------------
    static final String NS_SCENARIOS = "http://www.xoev.de/de/validator/framework/1/scenarios";      // scenarios.xsd
    static final String NS_REPORT_INPUT = "http://www.xoev.de/de/validator/framework/1/createreportinput"; // createReportInput.xsd
    static final String NS_SVRL = "http://purl.oclc.org/dsdl/svrl";
    static final String NS_XHTML = "http://www.w3.org/1999/xhtml";
    static final String NS_ASSERTIONS = "http://www.xoev.de/de/validator/framework/1/assertions";
    static final String FRAMEWORK_VERSION = "1.0.2";          // app-info.properties: framework_version
    static final String ENGINE_NAME = "KoSIT Validator";      // app-info.properties: engine_name
    static final String VALIDATOR_VERSION = "1.6.3";          // CHANGELOG.md 1.6.3 - 2026-08-20 (pom: 1.6.4-SNAPSHOT)
    static final String DIGEST_ALGORITHM = "SHA-256";         // InputFactory.DEFAULT_ALGORITH
    static final String FALLBACK_NAME = "Fallback-Scenario";  // FallbackBuilder.createObject()
    static final String FALLBACK_MATCH = "count(/)<0";        // FallbackBuilder.createObject()

    enum AcceptRecommendation { UNDEFINED, ACCEPTABLE, REJECT }   // api/AcceptRecommendation.java

    enum Severity { SEVERITY_WARNING, SEVERITY_ERROR, SEVERITY_FATAL_ERROR } // createReportInput.xsd

    // ----------------------------------------------------------------------------------------------
    // impl/model/Result.java — isValid() = object != null && errors.isEmpty()
    // ----------------------------------------------------------------------------------------------
    static final class Result<T, E> {
        final T object;
        final List<E> errors;
        Result(final T object, final List<E> errors) { this.object = object; this.errors = errors; }
        Result(final T object) { this(object, Collections.emptyList()); }
        static <T, E> Result<T, E> ofErrors(final List<E> errors) { return new Result<>(null, errors); }
        boolean isValid() { return this.object != null && this.errors.isEmpty(); }
        boolean isInvalid() { return !isValid(); }
    }

    // createReportInput.xsd: XMLSyntaxError (message, severityCode, rowNumber?, columnNumber?)
    static final class XMLSyntaxError {
        String message;
        Severity severity;
        Integer row;     // JAXB Integer: absent element when null
        Integer column;
    }

    // ----------------------------------------------------------------------------------------------
    // impl/CollectingErrorEventHandler.java (SAX part); hasErrors() ignores warnings
    // ----------------------------------------------------------------------------------------------
    static final class CollectingErrorHandler implements ErrorHandler {
        final List<XMLSyntaxError> errors = new ArrayList<>();
        private XMLSyntaxError create(final Severity s, final SAXParseException e) {
            final XMLSyntaxError x = new XMLSyntaxError();
            x.severity = s; x.message = e.getMessage();
            x.row = e.getLineNumber(); x.column = e.getColumnNumber(); // int -> Integer, may be -1
            return x;
        }
        @Override public void warning(final SAXParseException e) { this.errors.add(create(Severity.SEVERITY_WARNING, e)); }
        @Override public void error(final SAXParseException e) { this.errors.add(create(Severity.SEVERITY_ERROR, e)); }
        @Override public void fatalError(final SAXParseException e) { this.errors.add(create(Severity.SEVERITY_FATAL_ERROR, e)); }
        boolean hasErrors() { return !this.errors.isEmpty() && this.errors.stream().anyMatch(e -> e.severity != Severity.SEVERITY_WARNING); }
        String description() {
            return this.errors.stream().map(e -> e.severity + " " + e.message + " At row " + e.row + " at pos " + e.column).collect(Collectors.joining("\n"));
        }
    }

    // ----------------------------------------------------------------------------------------------
    // impl/xml/RelativeUriResolver.java — resolves only inside the repository
    // ----------------------------------------------------------------------------------------------
    static final class RelativeUriResolver implements URIResolver {
        final URI baseUri;
        RelativeUriResolver(final URI baseUri) { this.baseUri = baseUri; }
        @Override public Source resolve(final String href, final String base) throws TransformerException {
            final URI resolved = URI.create(base).resolve(URI.create(href));
            if (isUnderBaseUri(resolved)) {
                try {
                    return new StreamSource(resolved.toURL().openStream(), resolved.toASCIIString());
                } catch (final IOException e) {
                    throw new TransformerException("Can not resolve required  " + href, e);
                }
            }
            throw new TransformerException("The resolved transformation artifact " + resolved + " is not within the configured repository " + this.baseUri);
        }
        boolean isUnderBaseUri(final URI resolved) {
            final String b = this.baseUri.toASCIIString().replaceAll("file:/+", "");
            final String r = resolved.toASCIIString().replaceAll("file:/+", "");
            return r.startsWith(b);
        }
    }

    // ----------------------------------------------------------------------------------------------
    // impl/xml/ProcessorProvider.java
    // ----------------------------------------------------------------------------------------------
    static Processor createProcessor() {
        final Processor processor = new Processor(false);
        processor.getUnderlyingConfiguration().setCollectionFinder((context, uri) -> { throw new IllegalStateException("Configuration error. Resolving is not allowed"); });
        processor.getUnderlyingConfiguration().setUnparsedTextURIResolver((uri, enc, cfg) -> { throw new IllegalStateException("Configuration error. Resolving is not allowed"); });
        processor.setConfigurationProperty(Feature.DTD_VALIDATION, false);
        processor.setConfigurationProperty(Feature.ENTITY_RESOLVER_CLASS, "");
        processor.setConfigurationProperty(Feature.XINCLUDE, false);
        processor.setConfigurationProperty(Feature.ALLOW_EXTERNAL_FUNCTIONS, false);
        processor.setConfigurationProperty(FeatureKeys.XML_PARSER_FEATURE + enc("http://javax.xml.XMLConstants/feature/secure-processing"), true);
        processor.setConfigurationProperty(FeatureKeys.XML_PARSER_FEATURE + enc("http://apache.org/xml/features/disallow-doctype-decl"), true);
        processor.setConfigurationProperty(FeatureKeys.XML_PARSER_FEATURE + enc("http://apache.org/xml/features/nonvalidating/load-external-dtd"), false);
        processor.setConfigurationProperty(FeatureKeys.XML_PARSER_FEATURE + enc(XMLConstants.ACCESS_EXTERNAL_DTD), false);
        return processor;
    }

    static String enc(final String s) { return java.net.URLEncoder.encode(s, StandardCharsets.UTF_8); }

    // ----------------------------------------------------------------------------------------------
    // impl/xml/StrictRelativeResolvingStrategy.java (default ResolvingMode.STRICT_RELATIVE)
    // ----------------------------------------------------------------------------------------------
    static SchemaFactory createSchemaFactory() throws SAXException {
        final SchemaFactory sf = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
        sf.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        sf.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "file");
        sf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        return sf;
    }

    static Validator createValidator(final Schema schema) throws SAXException {
        final Validator validator = schema.newValidator();
        validator.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        validator.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "file");
        validator.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        return validator;
    }

    // ----------------------------------------------------------------------------------------------
    // Scenario (impl/Scenario.java + the parts of model/scenarios needed for the report)
    // ----------------------------------------------------------------------------------------------
    static final class Resource { String name; String location; }

    static final class Transformation {
        final XsltExecutable executable;
        final Resource resource;
        Transformation(final XsltExecutable executable, final Resource resource) { this.executable = executable; this.resource = resource; }
    }

    static final class Scenario {
        String name;
        String definitionXml;                  // the <s:scenario> element of scenarios.xml as JAXB round-trips it (copied into createReportInput)
        boolean fallback;
        XPathExecutable match;
        XPathExecutable accept;                // null if no acceptMatch
        Schema schema;                         // null for the fallback scenario
        final List<Resource> schemaResources = new ArrayList<>();
        final List<Transformation> schematron = new ArrayList<>();
        Transformation report;
        final Map<String, String> customLevels = new LinkedHashMap<>(); // assertion id -> level (DefaultCheck.buildCustomFailedAssertsList)
    }

    static final class Configuration {
        String name, author, date;
        final List<Scenario> scenarios = new ArrayList<>();
        Scenario fallback;
        URIResolver resolver;
    }

    // ----------------------------------------------------------------------------------------------
    // impl/tasks/CheckAction.java: Bag
    // ----------------------------------------------------------------------------------------------
    static final class Bag {
        final Path file;
        final String inputName;               // ResourceInput.name = url.getFile()
        byte[] hash;
        Result<XdmNode, XMLSyntaxError> parserResult;
        Scenario scenario;                    // scenarioSelectionResult.getObject()
        Result<Boolean, XMLSyntaxError> schemaValidationResult;
        final List<SchematronStep> schematronResults = new ArrayList<>();
        final List<String> processingErrors = new ArrayList<>();
        boolean stopped, finished;
        AcceptRecommendation acceptStatus = AcceptRecommendation.UNDEFINED;
        Document reportInput;                 // the createReportInput document (DOM)
        XdmNode report;
        Integer assertionsRun; List<String> assertionErrors;
        final String timestamp;
        Bag(final Path file, final String inputName) {
            this.file = file; this.inputName = inputName;
            this.timestamp = createTimestamp(); // DefaultCheck.createReport(): timestamp at construction
        }
        void stopProcessing(final String error) { stopProcessing(Collections.singletonList(error)); }
        void stopProcessing(final List<String> errors) { this.stopped = true; this.processingErrors.addAll(errors); }
        /** Bag.getName(): path stripped, extension stripped (FilenameUtils.getBaseName) */
        String getName() {
            final String fileName = this.inputName.replaceAll(".*/|.*\\\\", "");
            final int dot = fileName.lastIndexOf('.');
            return dot < 0 ? fileName : fileName.substring(0, dot);
        }
    }

    static final class SchematronStep {
        Resource resource;
        XdmNode svrl;          // null => "createErrorResult()": empty svrl:schematron-output
    }

    // impl/DateFactory.java: XMLGregorianCalendar of GregorianCalendar(now) -> xs:dateTime with millis + zone
    static String createTimestamp() {
        try {
            final GregorianCalendar cal = new GregorianCalendar();
            cal.setTime(new java.util.Date());
            return DatatypeFactory.newInstance().newXMLGregorianCalendar(cal).toXMLFormat();
        } catch (final Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // ----------------------------------------------------------------------------------------------
    // Options (cmd/CommandLineOptions.java)
    // ----------------------------------------------------------------------------------------------
    static final class Options {
        final List<Path> scenarios = new ArrayList<>();
        final List<Path> repositories = new ArrayList<>();
        Path outputPath = Paths.get(".");
        boolean extractHtml, serializeInput, printReport, printMemoryStats, debug;
        Path assertions;
        String reportPrefix, reportPostfix, logLevel = "OFF";
        final List<Path> files = new ArrayList<>();
        int threads = 1;
        String engineName = null;
        Path xsdDir;
    }

    static Options parse(final String[] args) {
        final Options o = new Options();
        for (int i = 0; i < args.length; i++) {
            final String a = args[i];
            switch (a) {
                case "-s": case "--scenarios": o.scenarios.add(Paths.get(stripName(args[++i]))); break;
                case "-r": case "--repository": o.repositories.add(Paths.get(stripName(args[++i]))); break;
                case "-o": case "--output-directory": o.outputPath = Paths.get(args[++i]); break;
                case "-h": case "--html": case "--extract-html": o.extractHtml = true; break;
                case "--serialize-report-input": o.serializeInput = true; break;
                case "-c": case "--check-assertions": o.assertions = Paths.get(args[++i]); break;
                case "--report-postfix": o.reportPostfix = args[++i]; break;
                case "--report-prefix": o.reportPrefix = args[++i]; break;
                case "-m": case "--memory-stats": o.printMemoryStats = true; break;
                case "-p": case "--print": o.printReport = true; break;
                case "-d": case "--debug": o.debug = true; break;
                case "-X": case "--debug-logging": o.logLevel = "DEBUG"; break;
                case "-l": case "--log-level": o.logLevel = args[++i]; break;
                case "-?": case "--help": usage(System.out); System.exit(0); break;
                case "--threads": o.threads = Integer.parseInt(args[++i]); break;
                case "--engine-name": o.engineName = args[++i]; break;
                case "--xsd-dir": o.xsdDir = Paths.get(args[++i]); break;
                default:
                    if (a.startsWith("-")) throw new IllegalArgumentException("Unknown option: " + a);
                    o.files.add(Paths.get(a));
            }
        }
        if (o.scenarios.isEmpty()) throw new IllegalArgumentException("Missing required option: '--scenarios scenario.xml'");
        return o;
    }

    /** TypeConverter: "NAME=path" or "path" */
    static String stripName(final String v) { final String[] s = v.split("="); return s.length == 2 ? s[1].trim() : s[0].trim(); }

    static void usage(final PrintStream out) {
        out.println("Usage: KositReference -s scenarios.xml [-r repository-path] [-o dir] [-h] [--serialize-report-input] [-c assertions-file]");
        out.println("       [--report-prefix p] [--report-postfix p] [-p] [-l level] [-d] [-X] [-m] [--threads n] [--engine-name n] [--xsd-dir d] FILE...");
    }

    // ----------------------------------------------------------------------------------------------
    // main (cmd/CommandLineApplication.java + cmd/Validator.java)
    // ----------------------------------------------------------------------------------------------
    public static void main(final String[] args) throws Exception {
        Options options;
        try {
            options = parse(args);
        } catch (final RuntimeException e) {
            System.err.println("Error processing command line arguments: " + e.getMessage());
            usage(System.out);
            System.exit(-1);
            return;
        }
        int code;
        try {
            code = run(options);
        } catch (final Exception e) {
            e.printStackTrace();
            System.err.println(e.getMessage());
            code = -2;
        }
        if (code >= 0) {
            System.out.println("\n##############################");
            System.out.println(code == 0 ? "#   Validation successful!   #" : "#     Validation failed!     #");
            System.out.println("##############################");
        }
        System.exit(code);
    }

    static final class Engine {
        final Processor processor;
        final Configuration configuration;
        final Schema reportInputSchema;
        final String engineName;
        Engine(final Processor p, final Configuration c, final Schema s, final String engineName) { this.processor = p; this.configuration = c; this.reportInputSchema = s; this.engineName = engineName; }
    }

    static int run(final Options o) throws Exception {
        System.out.println(ENGINE_NAME + " version " + VALIDATOR_VERSION + " (KositReference re-implementation, Saxon " + createProcessor().getSaxonProductVersion() + ")");
        final long start = System.currentTimeMillis();
        final Processor processor = createProcessor();
        // Validator.getConfiguration(): one configuration per -s; repository = -r (same index) or the scenario's directory
        if (o.scenarios.size() != 1) throw new IllegalArgumentException("This re-implementation supports exactly one -s scenarios.xml");
        final Path scenarioFile = o.scenarios.get(0);
        if (!Files.isRegularFile(scenarioFile)) throw new IllegalArgumentException("Not a valid path for scenario definition specified: '" + scenarioFile.toAbsolutePath() + "'");
        final URI scenarioLocation = scenarioFile.toUri();
        final URI repositoryLocation;
        if (o.repositories.isEmpty()) {
            repositoryLocation = scenarioFile.toAbsolutePath().getParent().toUri();
        } else {
            final Path r = o.repositories.get(0);
            if (!Files.isDirectory(r)) throw new IllegalArgumentException("Not a valid path for repository definition specified: '" + r.toAbsolutePath() + "'");
            repositoryLocation = r.toUri();
        }
        System.out.println("Loading scenarios from  " + scenarioLocation);
        System.out.println("Using repository  " + repositoryLocation);
        System.out.println();
        final Path xsdDir = o.xsdDir != null ? o.xsdDir : Paths.get(System.getProperty("kosit.xsd.dir", "xsd"));
        final Configuration configuration = loadConfiguration(processor, scenarioLocation, repositoryLocation, xsdDir);
        System.out.println("Loaded \"" + configuration.name + "\" by " + configuration.author + " from " + configuration.date + " ");
        System.out.println("The following scenarios are available:");
        for (final Scenario s : configuration.scenarios) System.out.println("  * " + s.name);
        System.out.println();
        final Schema reportInputSchema = loadReportInputSchema(xsdDir);
        // EngineInformation: engine_name + " " + project_version; marked as re-implementation so that the reports
        // cannot be mistaken for output of the official JAR (override with --engine-name)
        final String engineName = o.engineName != null ? o.engineName : ENGINE_NAME + " " + VALIDATOR_VERSION + " (KositReference re-implementation)";
        final Engine engine = new Engine(processor, configuration, reportInputSchema, engineName);

        final Path outputDirectory = o.outputPath;
        if ((!Files.exists(outputDirectory) && !outputDirectory.toFile().mkdirs()) || !Files.isDirectory(outputDirectory)) {
            throw new IllegalStateException("Invalid target directory " + outputDirectory + " specified");
        }
        final Assertions assertions = o.assertions != null && Files.exists(o.assertions) ? loadAssertions(processor, o.assertions) : null;

        // Validator.determineTestTargets(): files or directories (only *.xml, not recursive)
        final List<Path> targets = new ArrayList<>();
        for (final Path p : o.files) {
            if (Files.isDirectory(p)) {
                try (var stream = Files.list(p)) {
                    stream.filter(x -> x.toString().toLowerCase().endsWith(".xml")).sorted().forEach(targets::add);
                }
            } else if (Files.exists(p)) {
                targets.add(p);
            } else {
                System.err.println("The specified test target " + p + " does not exist. Will be ignored");
            }
        }
        if (targets.isEmpty()) throw new IllegalStateException("No test targets found. Nothing to check. Will quit now!");
        System.out.println("Setup completed in " + (System.currentTimeMillis() - start) + "ms\n");
        System.out.println("\nProcessing of " + targets.size() + " objects started");
        final long t0 = System.currentTimeMillis();

        final ExecutorService pool = Executors.newFixedThreadPool(Math.max(1, o.threads));
        final List<Future<Bag>> futures = new ArrayList<>();
        for (final Path target : targets) {
            futures.add(pool.submit(() -> {
                final Bag bag = checkInput(engine, target);
                // CLI actions appended to the check steps (Validator.processActions)
                if (o.extractHtml) extractHtml(engine, bag, outputDirectory);
                serializeReport(engine, bag, outputDirectory, o.reportPrefix, o.reportPostfix);
                if (o.serializeInput) serializeReportInput(bag, outputDirectory);
                if (o.printReport) printReport(engine, bag);
                if (assertions != null) checkAssertions(engine, assertions, bag);
                return bag;
            }));
        }
        final Map<String, Bag> results = new TreeMap<>();
        int checkAssertions = 0, failedAssertions = 0;
        int done = 0;
        for (final Future<Bag> f : futures) {
            final Bag bag = f.get();
            results.put(bag.inputName, bag);
            if (bag.assertionsRun != null) { checkAssertions += bag.assertionsRun; failedAssertions += bag.assertionErrors.size(); }
            done++;
            if (done % 200 == 0) System.out.println(done + "/" + targets.size() + " objects processed");
        }
        pool.shutdown();
        final long processingTime = System.currentTimeMillis() - t0;
        System.out.println("Processing of " + targets.size() + " objects completed in " + processingTime + "ms");
        printResults(results, checkAssertions, failedAssertions);
        // InternalCheck.isSuccessful / getNotAcceptableCount
        final long notAcceptable = results.values().stream().filter(b -> !isAcceptable(b)).count();
        final boolean successful = checkAssertions > 0 ? failedAssertions == 0 : notAcceptable == 0;
        return successful ? 0 : (int) (failedAssertions + notAcceptable);
    }

    // DefaultResult.isAcceptable(): processing successful && ACCEPTABLE
    static boolean isAcceptable(final Bag b) { return !b.stopped && b.finished && b.acceptStatus == AcceptRecommendation.ACCEPTABLE; }

    // InternalCheck.printResults — plain text version of the grid (without ANSI colours / column wrapping)
    static void printResults(final Map<String, Bag> results, final int checkAssertions, final int failedAssertions) {
        System.out.println("Results:");
        System.out.println(String.format("%-60s %-7s %-10s %-10s %s", "File", "Schema", "Schematron", "Acceptance", "Error/Description"));
        for (final Map.Entry<String, Bag> e : results.entrySet()) {
            final Bag b = e.getValue();
            // DefaultResult.isSchemaValid(): schemaViolations != null && empty; isSchematronValid(): evaluated && no failed-assert
            final boolean schemaValid = b.schemaValidationResult != null && b.schemaValidationResult.errors.isEmpty();
            final boolean schematronEvaluated = !b.schematronResults.isEmpty() && b.schematronResults.stream().noneMatch(s -> !hasSvrlContent(s.svrl));
            final boolean schematronValid = schematronEvaluated && b.schematronResults.stream().allMatch(s -> countFailedAsserts(s.svrl) == 0);
            final StringBuilder desc = new StringBuilder(String.join(";", b.processingErrors));
            if (b.schemaValidationResult != null && !b.schemaValidationResult.errors.isEmpty()) {
                if (desc.length() > 0) desc.append(";");
                desc.append(b.schemaValidationResult.errors.stream().map(x -> x.message).collect(Collectors.joining(";")));
            }
            System.out.println(String.format("%-60s %-7s %-10s %-10s %s", e.getKey(), schemaValid ? "Y" : "N", schematronValid ? "Y" : "N", b.acceptStatus, abbreviate(desc.toString(), 120)));
        }
        final long acceptable = results.values().stream().filter(KositReference::isAcceptable).count();
        final long rejected = results.size() - acceptable;
        final long errors = results.values().stream().filter(b -> b.stopped || !b.finished).count();
        System.out.println("Acceptable: " + acceptable + " Rejected: " + rejected + (errors > 0 ? " Processing errors: " + errors : ""));
        if (checkAssertions > 0) System.out.println("Assertions run: " + checkAssertions + ", Assertions failed: " + failedAssertions);
    }

    static String abbreviate(final String s, final int n) { return s.length() <= n ? s : s.substring(0, n - 3) + "..."; }

    // ----------------------------------------------------------------------------------------------
    // config/ConfigurationLoader.java + impl/ContentRepository.java
    // ----------------------------------------------------------------------------------------------
    static Configuration loadConfiguration(final Processor processor, final URI scenarioDefinition, final URI repository, final Path xsdDir) throws Exception {
        final Document doc = parseSecure(scenarioDefinition.toURL().openStream(), scenarioDefinition.toASCIIString());
        final Element root = doc.getDocumentElement();
        // ConfigurationLoader.checkVersion(): frameworkVersion must start with "1" and the namespace must match
        final String fv = root.getAttribute("frameworkVersion");
        if (!(fv.startsWith("1") && NS_SCENARIOS.equals(root.getNamespaceURI()))) {
            throw new IllegalStateException("Specified scenario configuration " + scenarioDefinition + " is not supported.\nThis version only supports definitions of '" + NS_SCENARIOS + "'");
        }
        // ConfigurationLoader.loadScenarios(): schema-validated unmarshalling against scenarios.xsd
        final SchemaFactory sf = createSchemaFactory();
        final Path scenariosXsd = xsdDir.resolve("scenarios.xsd");
        if (!Files.isRegularFile(scenariosXsd)) throw new IllegalStateException("scenarios.xsd not found in " + xsdDir + " (use --xsd-dir)");
        final Schema scenarioSchema = sf.newSchema(new StreamSource(scenariosXsd.toFile()));
        final CollectingErrorHandler h = new CollectingErrorHandler();
        final Validator v = createValidator(scenarioSchema);
        v.setErrorHandler(h);
        v.validate(new DOMSource(doc));
        if (h.hasErrors()) throw new IllegalStateException("Can not load scenarios from " + scenarioDefinition + " due to " + h.description());

        final Configuration c = new Configuration();
        c.name = text(child(root, NS_SCENARIOS, "name"));
        c.author = text(child(root, NS_SCENARIOS, "author"));
        c.date = text(child(root, NS_SCENARIOS, "date"));
        c.resolver = new RelativeUriResolver(repository);
        final SchemaFactory schemaFactory = createSchemaFactory();
        for (final Element def : children(root, NS_SCENARIOS, "scenario")) {
            final Scenario s = new Scenario();
            s.name = text(child(def, NS_SCENARIOS, "name"));
            s.definitionXml = serialize(copyScenario(newDocument(), def)); // immutable copy: DOM nodes are not thread-safe
            final Map<String, String> ns = new LinkedHashMap<>();
            for (final Element n : children(def, NS_SCENARIOS, "namespace")) ns.put(n.getAttribute("prefix"), n.getTextContent().trim()); // StringTrimAdapter
            s.match = compileXPath(processor, text(child(def, NS_SCENARIOS, "match")), ns);
            final Element vws = child(def, NS_SCENARIOS, "validateWithXmlSchema");
            if (vws != null) {
                final List<Source> sources = new ArrayList<>();
                for (final Element r : children(vws, NS_SCENARIOS, "resource")) {
                    final Resource res = resource(r);
                    s.schemaResources.add(res);
                    sources.add(c.resolver.resolve(res.location, repository.toString()));
                }
                schemaFactory.setResourceResolver(null);
                try {
                    s.schema = schemaFactory.newSchema(sources.toArray(new Source[0]));
                } catch (final SAXException e) {
                    throw new IllegalArgumentException("Can not load schema from sources " + sources.get(0).getSystemId(), e);
                }
            }
            for (final Element vs : children(def, NS_SCENARIOS, "validateWithSchematron")) {
                final Resource res = resource(child(vs, NS_SCENARIOS, "resource"));
                s.schematron.add(new Transformation(loadXslt(processor, c.resolver, repository, res.location), res));
            }
            final Element cr = child(def, NS_SCENARIOS, "createReport");
            if (cr != null) {
                final Resource res = resource(child(cr, NS_SCENARIOS, "resource"));
                s.report = new Transformation(loadXslt(processor, c.resolver, repository, res.location), res);
                for (final Element cl : children(cr, NS_SCENARIOS, "customLevel")) {
                    for (final String id : cl.getTextContent().trim().split("\\s+")) if (!id.isEmpty()) s.customLevels.put(id, cl.getAttribute("level"));
                }
            } else {
                throw new IllegalStateException("Scenario without createReport is not supported by this re-implementation (validator would use identity.xsl)");
            }
            final Element am = child(def, NS_SCENARIOS, "acceptMatch");
            if (am != null) s.accept = compileXPath(processor, am.getTextContent().trim(), ns);
            c.scenarios.add(s);
        }
        // ConfigurationLoader.createFallback(): FallbackBuilder with the noScenarioReport resource
        final Element nsr = child(root, NS_SCENARIOS, "noScenarioReport");
        final Resource fallbackRes = resource(child(nsr, NS_SCENARIOS, "resource"));
        final Scenario fb = new Scenario();
        fb.name = FALLBACK_NAME;
        fb.fallback = true;
        fb.match = compileXPath(processor, FALLBACK_MATCH, Collections.emptyMap());
        fb.report = new Transformation(loadXslt(processor, c.resolver, repository, fallbackRes.location), fallbackRes);
        // acceptMatch "count(/)<0" is set in the ScenarioType but no accept executable is created (FallbackBuilder.build)
        c.fallback = fb;
        return c;
    }

    static Schema loadReportInputSchema(final Path xsdDir) throws Exception {
        final Path xsd = xsdDir.resolve("createReportInput.xsd");
        if (!Files.isRegularFile(xsd)) throw new IllegalStateException("createReportInput.xsd not found in " + xsdDir + " (use --xsd-dir; it must also contain scenarios.xsd, svrl-kosit.xsd and xml.xsd)");
        final SchemaFactory sf = createSchemaFactory();
        return sf.newSchema(new StreamSource(xsd.toFile()));
    }

    static XPathExecutable compileXPath(final Processor p, final String expression, final Map<String, String> namespaces) {
        try {
            final XPathCompiler compiler = p.newXPathCompiler();
            namespaces.forEach(compiler::declareNamespace);
            return compiler.compile(expression);
        } catch (final SaxonApiException e) {
            throw new IllegalStateException("Can not compile xpath match expression '" + expression + "'", e);
        }
    }

    // ContentRepository.loadXsltScript(): XsltCompiler with the repository resolver, source resolved in the repository
    static XsltExecutable loadXslt(final Processor p, final URIResolver resolver, final URI repository, final String location) throws Exception {
        final XsltCompiler compiler = p.newXsltCompiler();
        compiler.setURIResolver(resolver);
        try {
            return compiler.compile(resolver.resolve(location, repository.toString()));
        } catch (final SaxonApiException e) {
            throw new IllegalStateException("Can not compile xslt executable for uri " + location, e);
        }
    }

    static Resource resource(final Element r) {
        final Resource res = new Resource();
        res.name = text(child(r, NS_SCENARIOS, "name"));
        res.location = text(child(r, NS_SCENARIOS, "location"));
        return res;
    }

    // ----------------------------------------------------------------------------------------------
    // DefaultCheck.runCheckInternal(): the eight check steps
    // ----------------------------------------------------------------------------------------------
    static Bag checkInput(final Engine engine, final Path file) throws Exception {
        final URL url = file.toUri().toURL();
        final Bag bag = new Bag(file, url.getFile());  // InputFactory.read(Path) -> ResourceInput(url, url.getFile(), SHA-256)
        // 1. DocumentParseAction (the digest is computed while the stream is read: StreamHelper.wrapDigesting)
        documentParse(engine, bag);
        // 2. CreateDocumentIdentificationAction — hash + reference (done in buildReportInput)
        // 3. ScenarioSelectionAction
        scenarioSelection(engine, bag);
        // 4. SchemaValidationAction (skipped when the scenario has no schema)
        if (bag.scenario.schema != null) schemaValidation(engine, bag);
        // 5. SchematronValidationAction (skipped when no schematrons, no schema result or schema result invalid)
        if (!(bag.scenario.schematron.isEmpty() || bag.schemaValidationResult == null || bag.schemaValidationResult.isInvalid())) schematronValidation(engine, bag);
        // 6. ValidateReportInputAction
        validateReportInput(engine, bag);
        // 7. CreateReportAction
        createReport(engine, bag);
        // 8. ComputeAcceptanceAction
        computeAcceptance(bag);
        bag.finished = true;
        return bag;
    }

    static void documentParse(final Engine engine, final Bag bag) {
        try {
            final byte[] bytes = Files.readAllBytes(bag.file);
            bag.hash = MessageDigest.getInstance(DIGEST_ALGORITHM).digest(bytes);
            final DocumentBuilder builder = engine.processor.newDocumentBuilder();
            builder.setLineNumbering(true);
            final XdmNode doc = builder.build(new StreamSource(new ByteArrayInputStream(bytes), bag.inputName));
            bag.parserResult = new Result<>(doc, Collections.emptyList());
        } catch (final SaxonApiException | IOException | java.security.NoSuchAlgorithmException e) {
            final XMLSyntaxError error = new XMLSyntaxError();
            error.severity = Severity.SEVERITY_FATAL_ERROR;
            error.message = "IOException while reading resource " + bag.inputName + ": " + e.getMessage();
            bag.parserResult = Result.ofErrors(Arrays.asList(error));
        }
        if (bag.parserResult.isInvalid()) {
            bag.stopProcessing(bag.parserResult.errors.stream().map(e -> e.message).collect(Collectors.toList()));
        }
    }

    // ScenarioRepository.selectScenario(): exactly one match, otherwise fallback
    static void scenarioSelection(final Engine engine, final Bag bag) {
        if (!bag.parserResult.isValid()) { bag.scenario = engine.configuration.fallback; return; }
        final List<Scenario> matching = new ArrayList<>();
        for (final Scenario s : engine.configuration.scenarios) {
            try {
                final XPathSelector sel = s.match.load();
                sel.setContextItem(bag.parserResult.object);
                if (sel.effectiveBooleanValue()) matching.add(s);
            } catch (final SaxonApiException e) {
                System.err.println("Error evaluating xpath expression: " + e.getMessage());
            }
        }
        bag.scenario = matching.size() == 1 ? matching.get(0) : engine.configuration.fallback;
    }

    static void schemaValidation(final Engine engine, final Bag bag) {
        final Scenario scenario = bag.scenario;
        final CollectingErrorHandler errorHandler = new CollectingErrorHandler();
        try {
            final Validator validator = createValidator(scenario.schema);
            validator.setErrorHandler(errorHandler);
            // ResourceInput.supportsMultipleReads() == true: the source is read again from the URL
            validator.validate(new StreamSource(bag.file.toUri().toURL().openStream(), bag.inputName));
            bag.schemaValidationResult = new Result<>(!errorHandler.hasErrors(), errorHandler.errors);
        } catch (final SAXException | IOException e) {
            final String msg = "Error processing schema validation for scenario " + scenario.name;
            bag.stopProcessing(msg);
            bag.schemaValidationResult = new Result<>(Boolean.FALSE);
        }
    }

    static void schematronValidation(final Engine engine, final Bag bag) {
        for (final Transformation t : bag.scenario.schematron) {
            final SchematronStep step = new SchematronStep();
            step.resource = t.resource;
            try {
                final XsltTransformer transformer = t.executable.load();
                transformer.setURIResolver(engine.configuration.resolver);
                transformer.setMessageListener((MessageListener2) (content, errorCode, terminate, locator) -> { /* CollectingErrorEventHandler.message(): not collected */ });
                final XdmDestination result = new XdmDestination();
                transformer.setDestination(result);
                transformer.setInitialContextNode(bag.parserResult.object);
                transformer.transform();
                step.svrl = result.getXdmNode();
            } catch (final SaxonApiException e) {
                bag.stopProcessing("Error processing schematron validation " + t.resource.name + ". Error is " + e.getMessage());
                step.svrl = null; // createErrorResult(): empty schematron-output
            }
            bag.schematronResults.add(step);
        }
    }

    // ValidateReportInputAction: marshal with the createReportInput schema; errors stop the processing
    static void validateReportInput(final Engine engine, final Bag bag) throws Exception {
        bag.reportInput = buildReportInput(engine, bag);
        final CollectingErrorHandler h = new CollectingErrorHandler();
        final Validator v = createValidator(engine.reportInputSchema);
        v.setErrorHandler(h);
        try {
            v.validate(new DOMSource(bag.reportInput));
        } catch (final SAXException e) {
            final XMLSyntaxError x = new XMLSyntaxError(); x.severity = Severity.SEVERITY_FATAL_ERROR; x.message = e.getMessage();
            h.errors.add(x);
        }
        if (!h.errors.isEmpty()) {
            final String errs = h.errors.stream().map(e -> e.message + " At row " + e.row + " at pos " + e.column).collect(Collectors.toList()).toString();
            bag.stopProcessing("Report input has errors " + errs);
            bag.reportInput = buildReportInput(engine, bag); // the processing error becomes part of the report input
        }
    }

    static void createReport(final Engine engine, final Bag bag) {
        try {
            final XdmNode parsedDocument = bag.parserResult.isValid() ? bag.parserResult.object : createErrorInformation(engine, bag);
            final XdmNode root = engine.processor.newDocumentBuilder().build(new DOMSource(bag.reportInput));
            final XsltTransformer transformer = bag.scenario.report.executable.load();
            transformer.setInitialContextNode(root);
            transformer.setMessageListener((MessageListener2) (content, errorCode, terminate, locator) -> { });
            transformer.setURIResolver(engine.configuration.resolver);
            if (parsedDocument != null) transformer.setParameter(new QName("input-document"), parsedDocument);
            final XdmDestination destination = new XdmDestination();
            transformer.setDestination(destination);
            transformer.transform();
            bag.report = destination.getXdmNode();
        } catch (final SaxonApiException e) {
            bag.stopProcessing("Can not create final report: " + e.getMessage());
        }
    }

    // CreateReportAction.createErrorInformation(): <error-message xmlns="…createreportinput">messages</error-message>
    static XdmNode createErrorInformation(final Engine engine, final Bag bag) throws SaxonApiException {
        final String message = bag.parserResult.errors.stream().map(e -> e.message).collect(Collectors.joining());
        final Document d = newDocument();
        final Element e = d.createElementNS(NS_REPORT_INPUT, "error-message");
        e.setTextContent(message);
        d.appendChild(e);
        return engine.processor.newDocumentBuilder().build(new DOMSource(d));
    }

    static void computeAcceptance(final Bag bag) {
        if (bag.stopped && bag.parserResult.isValid()) return; // undefined
        final boolean preConditions = bag.report != null && bag.schemaValidationResult != null && bag.scenario != null;
        if (!preConditions) { bag.acceptStatus = AcceptRecommendation.REJECT; return; }
        if (bag.schemaValidationResult.isValid() && bag.scenario.accept != null) {
            try {
                final XPathSelector sel = bag.scenario.accept.load();
                sel.setContextItem(bag.report);
                bag.acceptStatus = sel.effectiveBooleanValue() ? AcceptRecommendation.ACCEPTABLE : AcceptRecommendation.REJECT;
            } catch (final SaxonApiException e) {
                bag.stopProcessing("Error evaluating accept recommendation: " + e.getMessage());
            }
        } else {
            final boolean schematronValid = bag.schematronResults.stream().allMatch(s -> countFailedAsserts(s.svrl) == 0);
            bag.acceptStatus = bag.schemaValidationResult.isValid() && schematronValid ? AcceptRecommendation.ACCEPTABLE : AcceptRecommendation.REJECT;
        }
    }

    static int countFailedAsserts(final XdmNode svrl) {
        if (svrl == null) return 0;
        int n = 0;
        for (final XdmNode out : elements(svrl)) for (final XdmNode c : elements(out)) if (NS_SVRL.equals(c.getNodeName().getNamespace()) && "failed-assert".equals(c.getNodeName().getLocalName())) n++;
        return n;
    }

    /** SchematronOutput.getActivePatternAndFiredRuleAndFailedAssert() not empty */
    static boolean hasSvrlContent(final XdmNode svrl) {
        if (svrl == null) return false;
        for (final XdmNode out : elements(svrl)) for (final XdmNode c : elements(out)) {
            final String l = c.getNodeName().getLocalName();
            if (NS_SVRL.equals(c.getNodeName().getNamespace()) && (l.equals("active-pattern") || l.equals("fired-rule") || l.equals("failed-assert") || l.equals("successful-report"))) return true;
        }
        return false;
    }

    static List<XdmNode> elements(final XdmNode parent) {
        final List<XdmNode> list = new ArrayList<>();
        for (final XdmNode c : parent.children()) if (c.getNodeKind() == XdmNodeKind.ELEMENT) list.add(c);
        return list;
    }

    // ----------------------------------------------------------------------------------------------
    // createReportInput (model/reportInput, JAXB-marshalled in the validator) — xsd/createReportInput.xsd
    // ----------------------------------------------------------------------------------------------
    static Document buildReportInput(final Engine engine, final Bag bag) throws Exception {
        final Document d = newDocument();
        final Element root = d.createElementNS(NS_REPORT_INPUT, "in:createReportInput");
        root.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:in", NS_REPORT_INPUT);
        root.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:s", NS_SCENARIOS);
        root.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:svrl", NS_SVRL);
        root.setAttribute("frameworkVersion", FRAMEWORK_VERSION);
        d.appendChild(root);
        // engine, timestamp (DefaultCheck.createReport)
        final Element engineEl = add(d, root, "in:engine");
        add(d, engineEl, "in:name").setTextContent(engine.engineName);
        add(d, root, "in:timestamp").setTextContent(bag.timestamp);
        // documentIdentification (CreateDocumentIdentificationAction)
        final Element di = add(d, root, "in:documentIdentification");
        final Element dh = add(d, di, "in:documentHash");
        add(d, dh, "in:hashAlgorithm").setTextContent(DIGEST_ALGORITHM);
        add(d, dh, "in:hashValue").setTextContent(bag.hash != null ? Base64.getEncoder().encodeToString(bag.hash) : "");
        add(d, di, "in:documentReference").setTextContent(bag.inputName);
        // s:scenario (ScenarioSelectionAction: only when not fallback) — the complete scenario definition
        if (bag.scenario != null && !bag.scenario.fallback) {
            final Document sd = parseSecure(new ByteArrayInputStream(bag.scenario.definitionXml.getBytes(StandardCharsets.UTF_8)), null);
            root.appendChild(d.importNode(sd.getDocumentElement(), true));
        }
        // validationResultsWellformedness (DocumentParseAction: always present)
        final Element wf = add(d, root, "in:validationResultsWellformedness");
        for (final XMLSyntaxError e : bag.parserResult.errors) appendSyntaxError(d, wf, e);
        // validationResultsXmlSchema (SchemaValidationAction: only when a schema exists)
        if (bag.schemaValidationResult != null) {
            final Element xs = add(d, root, "in:validationResultsXmlSchema");
            for (final Resource r : bag.scenario.schemaResources) appendResource(d, xs, r);
            if (!bag.schemaValidationResult.isValid()) for (final XMLSyntaxError e : bag.schemaValidationResult.errors) appendSyntaxError(d, xs, e);
        }
        // validationResultsSchematron (one per transformation)
        for (final SchematronStep s : bag.schematronResults) {
            final Element vs = add(d, root, "in:validationResultsSchematron");
            appendResource(d, vs, s.resource);
            final Element results = add(d, vs, "in:results");
            if (s.svrl == null) {
                results.appendChild(d.createElementNS(NS_SVRL, "svrl:schematron-output")); // new SchematronOutput()
            } else {
                // SchematronValidationAction: DOMSource(NodeOverNodeInfo.wrap(result).getOwnerDocument()) -> JAXB SchematronOutput
                final Node wrapped = net.sf.saxon.dom.NodeOverNodeInfo.wrap(s.svrl.getUnderlyingNode());
                final Element svrlRoot = wrapped instanceof Document ? ((Document) wrapped).getDocumentElement() : (Element) wrapped;
                results.appendChild(filterSvrl(d, svrlRoot));
            }
        }
        if (!bag.processingErrors.isEmpty()) {
            final Element pe = add(d, root, "in:processingError");
            for (final String msg : bag.processingErrors) add(d, pe, "in:error").setTextContent(msg.trim()); // xs:string -> StringTrimAdapter
        }
        return d;
    }

    static void appendSyntaxError(final Document d, final Element parent, final XMLSyntaxError e) {
        final Element x = add(d, parent, "in:xmlSyntaxError");
        add(d, x, "in:message").setTextContent(e.message == null ? "" : e.message);
        add(d, x, "in:severityCode").setTextContent(e.severity.name());
        if (e.row != null) add(d, x, "in:rowNumber").setTextContent(String.valueOf(e.row));
        if (e.column != null) add(d, x, "in:columnNumber").setTextContent(String.valueOf(e.column));
    }

    static void appendResource(final Document d, final Element parent, final Resource r) {
        final Element res = d.createElementNS(NS_SCENARIOS, "s:resource");
        parent.appendChild(res);
        final Element n = d.createElementNS(NS_SCENARIOS, "s:name"); n.setTextContent(r.name); res.appendChild(n);
        final Element l = d.createElementNS(NS_SCENARIOS, "s:location"); l.setTextContent(r.location); res.appendChild(l);
    }

    /** The ScenarioType as JAXB round-trips it: elements of the scenarios namespace only (comments dropped), prefix s. */
    static Element copyScenario(final Document d, final Element def) {
        final Element out = d.createElementNS(NS_SCENARIOS, "s:" + def.getLocalName());
        final NamedNodeMap attrs = def.getAttributes();
        for (int i = 0; i < attrs.getLength(); i++) {
            final Attr a = (Attr) attrs.item(i);
            if (XMLConstants.XMLNS_ATTRIBUTE_NS_URI.equals(a.getNamespaceURI())) continue;
            out.setAttributeNS(a.getNamespaceURI(), a.getName(), a.getValue());
        }
        final NodeList nl = def.getChildNodes();
        final boolean complex = hasElementChildren(def);
        for (int i = 0; i < nl.getLength(); i++) {
            final Node c = nl.item(i);
            if (c.getNodeType() == Node.ELEMENT_NODE && NS_SCENARIOS.equals(c.getNamespaceURI())) out.appendChild(copyScenario(d, (Element) c));
            else if (c.getNodeType() == Node.TEXT_NODE || c.getNodeType() == Node.CDATA_SECTION_NODE) {
                if (!complex) out.appendChild(d.createTextNode(c.getNodeValue()));
            }
        }
        return out;
    }

    static boolean hasElementChildren(final Element e) {
        final NodeList nl = e.getChildNodes();
        for (int i = 0; i < nl.getLength(); i++) if (nl.item(i).getNodeType() == Node.ELEMENT_NODE) return true;
        return false;
    }

    // svrl-kosit.xsd — the subset of SVRL that the validator's JAXB model (org.oclc.purl.dsdl.svrl) keeps
    static final Map<String, List<String>> SVRL_ATTRIBUTES = Map.ofEntries(
            Map.entry("schematron-output", List.of("phase", "schemaVersion", "title")),
            Map.entry("active-pattern", List.of("documents", "id", "name", "role")),
            Map.entry("fired-rule", List.of("context", "flag", "id", "name", "role")),
            Map.entry("failed-assert", List.of("flag", "id", "location", "role", "test")),
            Map.entry("successful-report", List.of("flag", "id", "location", "role", "test")),
            Map.entry("ns-prefix-in-attribute-values", List.of("prefix", "uri")),
            Map.entry("diagnostic-reference", List.of("diagnostic")),
            Map.entry("property-reference", List.of("property", "role", "scheme")),
            Map.entry("dir", List.of("class", "dir")),
            Map.entry("emph", List.of("class")),
            Map.entry("span", List.of("class")));
    static final Map<String, List<String>> SVRL_CHILDREN = Map.ofEntries(
            Map.entry("schematron-output", List.of("text", "ns-prefix-in-attribute-values", "active-pattern", "fired-rule", "failed-assert", "successful-report")),
            Map.entry("failed-assert", List.of("diagnostic-reference", "property-reference", "text")),
            Map.entry("successful-report", List.of("diagnostic-reference", "property-reference", "text")),
            Map.entry("diagnostic-reference", List.of("text")),
            Map.entry("property-reference", List.of("text")),
            Map.entry("text", List.of("dir", "span", "emph")));

    static Element filterSvrl(final Document d, final Element src) {
        final String local = src.getLocalName();
        final Element out = d.createElementNS(NS_SVRL, "svrl:" + local);
        final List<String> allowed = SVRL_ATTRIBUTES.getOrDefault(local, Collections.emptyList());
        final NamedNodeMap attrs = src.getAttributes();
        for (int i = 0; i < attrs.getLength(); i++) {
            final Attr a = (Attr) attrs.item(i);
            if (XMLConstants.XMLNS_ATTRIBUTE_NS_URI.equals(a.getNamespaceURI())) continue;
            final boolean isText = "text".equals(local);
            if (a.getNamespaceURI() == null || a.getNamespaceURI().isEmpty()) {
                if (allowed.contains(a.getLocalName()) || (isText && List.of("fpi", "icon", "see").contains(a.getLocalName()))) out.setAttribute(a.getLocalName(), a.getValue());
            } else if (isText) {
                out.setAttributeNS(a.getNamespaceURI(), a.getName(), a.getValue()); // xml:space, xml:lang, foreign attributes (anyAttribute)
            }
        }
        final boolean mixed = List.of("text", "dir", "emph", "span").contains(local);
        final List<String> childNames = SVRL_CHILDREN.getOrDefault(local, Collections.emptyList());
        final NodeList nl = src.getChildNodes();
        for (int i = 0; i < nl.getLength(); i++) {
            final Node c = nl.item(i);
            if (c.getNodeType() == Node.ELEMENT_NODE) {
                final Element ce = (Element) c;
                if (NS_SVRL.equals(ce.getNamespaceURI())) {
                    if (childNames.contains(ce.getLocalName())) out.appendChild(filterSvrl(d, ce));
                } else if ("text".equals(local)) {
                    out.appendChild(d.importNode(ce, true)); // foreign element (processContents="skip")
                }
            } else if ((c.getNodeType() == Node.TEXT_NODE || c.getNodeType() == Node.CDATA_SECTION_NODE) && mixed) {
                out.appendChild(d.createTextNode(c.getNodeValue()));
            }
        }
        return out;
    }

    // ----------------------------------------------------------------------------------------------
    // CLI actions: SerializeReportAction, ExtractHtmlContentAction, SerializeReportInputAction,
    // PrintReportAction, CheckAssertionAction
    // ----------------------------------------------------------------------------------------------
    // cmd/DefaultNamingStrategy.java
    static String createName(final String name, final String prefix, final String postfix) {
        final String base = name.toLowerCase().endsWith(".xml") ? name.substring(0, name.length() - 4) : name;
        final StringBuilder result = new StringBuilder();
        if (prefix != null && !prefix.isEmpty()) result.append(prefix).append("-");
        result.append(base);
        if (postfix != null && !postfix.isEmpty()) result.append("-").append(postfix);
        else if (prefix == null || prefix.isEmpty()) result.append("-").append("report");
        result.append(".xml");
        return result.toString();
    }

    static void serializeReport(final Engine engine, final Bag bag, final Path outputDirectory, final String prefix, final String postfix) {
        if (bag.report == null) { System.err.println("Can not serialize result report. No document found"); return; }
        final Path file = outputDirectory.resolve(createName(bag.getName(), prefix, postfix));
        try {
            final Serializer serializer = engine.processor.newSerializer(file.toFile());
            serializer.serializeNode(bag.report);
        } catch (final SaxonApiException e) {
            System.err.println("Can not serialize result report to " + file.toAbsolutePath() + ": " + e.getMessage());
        }
    }

    static void extractHtml(final Engine engine, final Bag bag, final Path outputDirectory) {
        if (bag.report == null) return;
        try {
            final XPathCompiler c = engine.processor.newXPathCompiler();
            c.declareNamespace("html", NS_XHTML);
            final XPathSelector sel = c.compile("//html:html").load();
            sel.setContextItem(bag.report);
            for (final XdmItem item : sel) {
                final XdmNode node = (XdmNode) item;
                final String name = bag.getName() + "-" + node.getAttributeValue(new QName("data-report-type"));
                final Path file = outputDirectory.resolve(name + ".html");
                engine.processor.newSerializer(file.toFile()).serializeNode(node);
            }
        } catch (final SaxonApiException e) {
            System.err.println("Error extracting html content: " + e.getMessage());
        }
    }

    static void serializeReportInput(final Bag bag, final Path outputDirectory) {
        final Path file = outputDirectory.resolve(bag.getName() + "-reportInput.xml");
        try {
            // ConversionService.writeXml: JAXB_FORMATTED_OUTPUT, JAXB_FRAGMENT (no XML declaration), UTF-8
            final javax.xml.transform.Transformer t = javax.xml.transform.TransformerFactory.newInstance().newTransformer();
            t.setOutputProperty(javax.xml.transform.OutputKeys.INDENT, "yes");
            t.setOutputProperty(javax.xml.transform.OutputKeys.OMIT_XML_DECLARATION, "yes");
            t.setOutputProperty(javax.xml.transform.OutputKeys.ENCODING, "UTF-8");
            t.transform(new DOMSource(bag.reportInput), new javax.xml.transform.stream.StreamResult(file.toFile()));
        } catch (final TransformerException e) {
            System.err.println("Can not serialize report input to " + file.toAbsolutePath() + ": " + e.getMessage());
        }
    }

    static void printReport(final Engine engine, final Bag bag) {
        if (bag.report == null) return;
        try {
            final StringWriter w = new StringWriter();
            engine.processor.newSerializer(w).serializeNode(bag.report);
            synchronized (System.out) { System.out.println(w); }
        } catch (final SaxonApiException e) {
            System.err.println("Error while printing result to stdout: " + e.getMessage());
        }
    }

    static final class Assertion { String reportDoc; String test; String text; XPathExecutable executable; }
    static final class Assertions { final Map<String, List<Assertion>> byReportDoc = new LinkedHashMap<>(); }

    static Assertions loadAssertions(final Processor p, final Path file) throws Exception {
        final Document d = parseSecure(Files.newInputStream(file), file.toUri().toASCIIString());
        final Map<String, String> ns = new LinkedHashMap<>();
        for (final Element n : children(d.getDocumentElement(), NS_ASSERTIONS, "namespace")) ns.put(n.getAttribute("prefix"), n.getTextContent().trim());
        final Assertions a = new Assertions();
        for (final Element e : children(d.getDocumentElement(), NS_ASSERTIONS, "assertion")) {
            final Assertion as = new Assertion();
            as.reportDoc = e.getAttribute("report-doc");
            as.test = e.getAttribute("test");
            as.text = e.getTextContent().trim();
            as.executable = compileXPath(p, as.test, ns);
            a.byReportDoc.computeIfAbsent(as.reportDoc, k -> new ArrayList<>()).add(as);
        }
        return a;
    }

    // CheckAssertionAction: matches(key, name) = key.startsWith(name) || (name + ".xml").endsWith(key); first match wins.
    // The validator iterates a HashMap (undefined order); here the exact "<name>-report.xml" key wins, then document order.
    static void checkAssertions(final Engine engine, final Assertions assertions, final Bag bag) {
        final String name = bag.getName();
        List<Assertion> toCheck = assertions.byReportDoc.get(name + "-report.xml");
        if (toCheck == null) {
            for (final Map.Entry<String, List<Assertion>> e : assertions.byReportDoc.entrySet()) {
                final String key = e.getKey();
                if (key.startsWith(name) || (name + ".xml").endsWith(key)) { toCheck = e.getValue(); break; }
            }
        }
        if (toCheck == null || toCheck.isEmpty()) { System.err.println("Can not find assertions for " + name); return; }
        final List<String> errors = new ArrayList<>();
        for (final Assertion a : toCheck) {
            boolean ok = false;
            try {
                final XPathSelector sel = a.executable.load();
                sel.setContextItem(bag.report);
                ok = sel.effectiveBooleanValue();
            } catch (final SaxonApiException | NullPointerException e) {
                System.err.println("Error evaluating assertion " + a.test + " for " + a.reportDoc + ": " + e.getMessage());
            }
            if (!ok) { System.err.println("Assertion mismatch [" + name + "]: " + a.text + " (" + a.test + ")"); errors.add(a.text); }
        }
        bag.assertionsRun = toCheck.size();
        bag.assertionErrors = errors;
    }

    // ----------------------------------------------------------------------------------------------
    // DOM helpers
    // ----------------------------------------------------------------------------------------------
    static Document newDocument() {
        try {
            final DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
            f.setNamespaceAware(true);
            return f.newDocumentBuilder().newDocument();
        } catch (final javax.xml.parsers.ParserConfigurationException e) {
            throw new IllegalStateException(e);
        }
    }

    // secure DOM parser (ConversionService.readXml: no external entities, no DTD)
    static Document parseSecure(final InputStream in, final String systemId) throws Exception {
        final DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setNamespaceAware(true);
        f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        f.setFeature("http://xml.org/sax/features/external-general-entities", false);
        f.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        f.setExpandEntityReferences(false);
        try (in) {
            return f.newDocumentBuilder().parse(in, systemId);
        }
    }

    static String serialize(final Element e) {
        try {
            final javax.xml.transform.Transformer t = javax.xml.transform.TransformerFactory.newInstance().newTransformer();
            t.setOutputProperty(javax.xml.transform.OutputKeys.OMIT_XML_DECLARATION, "yes");
            final StringWriter w = new StringWriter();
            t.transform(new DOMSource(e), new javax.xml.transform.stream.StreamResult(w));
            return w.toString();
        } catch (final TransformerException ex) {
            throw new IllegalStateException(ex);
        }
    }

    static Element add(final Document d, final Element parent, final String qname) {
        final Element e = d.createElementNS(NS_REPORT_INPUT, qname);
        parent.appendChild(e);
        return e;
    }

    static Element child(final Element parent, final String ns, final String local) {
        final List<Element> l = children(parent, ns, local);
        return l.isEmpty() ? null : l.get(0);
    }

    static List<Element> children(final Element parent, final String ns, final String local) {
        final List<Element> list = new ArrayList<>();
        final NodeList nl = parent.getChildNodes();
        for (int i = 0; i < nl.getLength(); i++) {
            final Node n = nl.item(i);
            if (n.getNodeType() == Node.ELEMENT_NODE && ns.equals(n.getNamespaceURI()) && local.equals(n.getLocalName())) list.add((Element) n);
        }
        return list;
    }

    static String text(final Element e) { return e == null ? null : e.getTextContent().trim(); }
}
