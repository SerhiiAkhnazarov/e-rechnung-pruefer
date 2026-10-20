/*
 * EncOracle — reference for the XML encoding detection: parses each file with the JDK's XML parser
 * (Xerces, javax.xml.parsers, namespace aware, secure processing) and prints one JSON line per file:
 * { file, wellFormed, encoding (Document.getXmlEncoding / getInputEncoding), text (string value of the
 * element <t>), error }.
 * Usage: java -cp test/encoding-oracle EncOracle <out.jsonl> <file>...
 */
import java.io.*;
import java.nio.charset.StandardCharsets;
import javax.xml.XMLConstants;
import javax.xml.parsers.*;
import org.w3c.dom.*;

public class EncOracle {
  static String q(String s) {
    if (s == null) return "null";
    StringBuilder b = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      if (c == '"' || c == '\\') b.append('\\').append(c);
      else if (c < 0x20 || c > 0x7e) b.append(String.format("\\u%04x", (int) c));
      else b.append(c);
    }
    return b.append('"').toString();
  }
  public static void main(String[] a) throws Exception {
    DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
    f.setNamespaceAware(true);
    f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
    f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    try (PrintWriter out = new PrintWriter(new OutputStreamWriter(new FileOutputStream(a[0]), StandardCharsets.UTF_8))) {
      for (int i = 1; i < a.length; i++) {
        String err = null, enc = null, text = null; boolean ok = false;
        try {
          DocumentBuilder db = f.newDocumentBuilder();
          db.setErrorHandler(null);
          Document d = db.parse(new File(a[i]));
          ok = true;
          enc = d.getInputEncoding();
          NodeList l = d.getElementsByTagName("t");
          text = l.getLength() > 0 ? l.item(0).getTextContent() : null;
        } catch (Exception e) { err = e.getClass().getSimpleName() + ": " + e.getMessage(); }
        out.println("{\"file\":" + q(a[i]) + ",\"wellFormed\":" + ok + ",\"encoding\":" + q(enc) + ",\"text\":" + q(text) + ",\"error\":" + q(err) + "}");
      }
    }
  }
}
