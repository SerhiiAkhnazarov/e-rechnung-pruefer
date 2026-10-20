/*
 * VeraMrr — runs the veraPDF library (org.verapdf:validation-model-jakarta, the artefact and version
 * Mustangproject validates ZUGFeRD/Factur-X PDFs with) over a list of PDF files and writes ONE
 * machine-readable report (MRR XML, the format of the veraPDF CLI's --format mrr) for all of them.
 *
 * Every API used was checked against the veraPDF-library sources at tag v1.30.3
 * (ValidatorConfigBuilder.defaultBuilder/flavour/build, ProcessorFactory.fromValues/fileBatchProcessor/
 * getHandler(FormatOption, boolean, OutputStream, boolean), BatchProcessor.process(List<File>,
 * BatchProcessingHandler), PDFAFlavour.fromString) and against Mustangproject's PDFValidator.java,
 * which uses VeraGreenfieldFoundryProvider.initialise(), FeatureFactory/FixerFactory/
 * PluginsCollectionConfig.defaultConfig() and TaskType.VALIDATE in the same way.
 *
 * Usage: java -cp "lib/*:." VeraMrr <flavour: 3b|3u|3a|0=auto> <out.xml> <file.pdf>...
 */
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;

import org.verapdf.features.FeatureFactory;
import org.verapdf.gf.foundry.VeraGreenfieldFoundryProvider;
import org.verapdf.metadata.fixer.FixerFactory;
import org.verapdf.pdfa.flavours.PDFAFlavour;
import org.verapdf.pdfa.validation.validators.ValidatorConfig;
import org.verapdf.pdfa.validation.validators.ValidatorConfigBuilder;
import org.verapdf.processor.BatchProcessingHandler;
import org.verapdf.processor.BatchProcessor;
import org.verapdf.processor.FormatOption;
import org.verapdf.processor.ProcessorConfig;
import org.verapdf.processor.ProcessorFactory;
import org.verapdf.processor.TaskType;
import org.verapdf.processor.plugins.PluginsCollectionConfig;
import org.verapdf.processor.reports.BatchSummary;

public class VeraMrr {
    public static void main(String[] args) throws Exception {
        if (args.length < 3) {
            System.err.println("usage: VeraMrr <3b|3u|3a|0> <out.xml> <file.pdf>...");
            System.exit(2);
        }
        VeraGreenfieldFoundryProvider.initialise();
        ValidatorConfigBuilder builder = ValidatorConfigBuilder.defaultBuilder();
        if (!"0".equals(args[0])) builder.flavour(PDFAFlavour.fromString(args[0]));
        ValidatorConfig validatorConfig = builder.build();
        ProcessorConfig config = ProcessorFactory.fromValues(validatorConfig, FeatureFactory.defaultConfig(),
                PluginsCollectionConfig.defaultConfig(), FixerFactory.defaultConfig(), EnumSet.of(TaskType.VALIDATE));
        List<File> files = new ArrayList<>();
        for (int i = 2; i < args.length; i++) files.add(new File(args[i]));
        try (OutputStream out = new FileOutputStream(args[1])) {
            BatchProcessingHandler handler = ProcessorFactory.getHandler(FormatOption.MRR, false, out, false);
            BatchProcessor processor = ProcessorFactory.fileBatchProcessor(config);
            BatchSummary summary = processor.process(files, handler);
            System.out.println("veraPDF " + args[0] + ": " + files.size() + " files, summary: " + summary);
        }
    }
}
