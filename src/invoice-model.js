/*
 * invoice-model.js — reads the human-relevant business terms (EN 16931 BT-/BG- identifiers) from a
 * UBL 2.1 (Invoice / CreditNote) or UN/CEFACT CII D16B document with XPath, so that the viewer can
 * show what the invoice says without the user reading XML.
 *
 * Licence: EUPL-1.2
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InvoiceModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NS = {
    ubl: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
    cn: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
    cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
    ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
    udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
    qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  };

  // Business terms: [id, label, UBL XPath (relative to root element), CII XPath (relative to root)]
  const HEADER_TERMS = [
    ['BT-1', 'Rechnungsnummer', 'cbc:ID', 'rsm:ExchangedDocument/ram:ID'],
    ['BT-2', 'Rechnungsdatum', 'cbc:IssueDate', 'rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString'],
    ['BT-3', 'Rechnungstyp (Code)', '(cbc:InvoiceTypeCode | cbc:CreditNoteTypeCode)', 'rsm:ExchangedDocument/ram:TypeCode'],
    ['BT-5', 'Währung', 'cbc:DocumentCurrencyCode', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceCurrencyCode'],
    ['BT-6', 'Umsatzsteuer-Währung', 'cbc:TaxCurrencyCode', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:TaxCurrencyCode'],
    ['BT-9', 'Fälligkeitsdatum', '(cbc:DueDate | cac:PaymentMeans/cbc:PaymentDueDate)[1]', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString'],
    ['BT-10', 'Käuferreferenz (Leitweg-ID)', 'cbc:BuyerReference', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerReference'],
    ['BT-11', 'Projektreferenz', 'cac:ProjectReference/cbc:ID', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SpecifiedProcuringProject/ram:ID'],
    ['BT-12', 'Vertragsnummer', 'cac:ContractDocumentReference/cbc:ID', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:ContractReferencedDocument/ram:IssuerAssignedID'],
    ['BT-13', 'Bestellnummer', 'cac:OrderReference/cbc:ID', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID'],
    ['BT-14', 'Auftragsnummer (Verkäufer)', 'cac:OrderReference/cbc:SalesOrderID', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerOrderReferencedDocument/ram:IssuerAssignedID'],
    ['BT-16', 'Lieferscheinnummer', 'cac:DespatchDocumentReference/cbc:ID', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery/ram:DespatchAdviceReferencedDocument/ram:IssuerAssignedID'],
    ['BT-19', 'Buchungsreferenz (Käufer)', 'cbc:AccountingCost', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ReceivableSpecifiedTradeAccountingAccount/ram:ID'],
    ['BT-20', 'Zahlungsbedingungen', 'cac:PaymentTerms/cbc:Note', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradePaymentTerms/ram:Description'],
    ['BT-22', 'Bemerkung', 'cbc:Note', 'rsm:ExchangedDocument/ram:IncludedNote/ram:Content'],
    ['BT-23', 'Geschäftsprozess', 'cbc:ProfileID', 'rsm:ExchangedDocumentContext/ram:BusinessProcessSpecifiedDocumentContextParameter/ram:ID'],
    ['BT-24', 'Spezifikationskennung', 'cbc:CustomizationID', 'rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID'],
    ['BT-25', 'Vorausgegangene Rechnung', 'cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceReferencedDocument/ram:IssuerAssignedID'],
    ['BT-72', 'Liefer-/Leistungsdatum', 'cac:Delivery/cbc:ActualDeliveryDate', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery/ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime/udt:DateTimeString'],
    ['BT-73', 'Leistungszeitraum von', 'cac:InvoicePeriod/cbc:StartDate', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:BillingSpecifiedPeriod/ram:StartDateTime/udt:DateTimeString'],
    ['BT-74', 'Leistungszeitraum bis', 'cac:InvoicePeriod/cbc:EndDate', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:BillingSpecifiedPeriod/ram:EndDateTime/udt:DateTimeString'],
  ];

  const SELLER_UBL = 'cac:AccountingSupplierParty/cac:Party';
  const SELLER_CII = 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty';
  const BUYER_UBL = 'cac:AccountingCustomerParty/cac:Party';
  const BUYER_CII = 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty';

  function partyTerms(prefix, base) {
    const u = base.ubl, c = base.cii;
    return [
      [prefix + '-27/44', 'Name', u + '/cac:PartyLegalEntity/cbc:RegistrationName', c + '/ram:Name'],
      [prefix + '-28/45', 'Handelsname', u + '/cac:PartyName/cbc:Name', c + '/ram:SpecifiedLegalOrganization/ram:TradingBusinessName'],
      [prefix + '-29/46', 'Kennung', u + '/cac:PartyIdentification/cbc:ID', c + '/ram:ID'],
      [prefix + '-30/47', 'Registernummer', u + '/cac:PartyLegalEntity/cbc:CompanyID', c + '/ram:SpecifiedLegalOrganization/ram:ID'],
      [prefix + '-31/48', 'USt-IdNr.', u + "/cac:PartyTaxScheme[cac:TaxScheme/cbc:ID='VAT']/cbc:CompanyID", c + "/ram:SpecifiedTaxRegistration/ram:ID[@schemeID='VA']"],
      [prefix + '-32', 'Steuernummer', u + "/cac:PartyTaxScheme[cac:TaxScheme/cbc:ID!='VAT']/cbc:CompanyID", c + "/ram:SpecifiedTaxRegistration/ram:ID[@schemeID='FC']"],
      [prefix + '-34/49', 'Elektronische Adresse', u + '/cbc:EndpointID', c + '/ram:URIUniversalCommunication/ram:URIID'],
      [prefix + '-34/49-1', 'Adress-Schema', u + '/cbc:EndpointID/@schemeID', c + '/ram:URIUniversalCommunication/ram:URIID/@schemeID'],
      [prefix + '-35/50', 'Straße', u + '/cac:PostalAddress/cbc:StreetName', c + '/ram:PostalTradeAddress/ram:LineOne'],
      [prefix + '-36/51', 'Adresszusatz', u + '/cac:PostalAddress/cbc:AdditionalStreetName', c + '/ram:PostalTradeAddress/ram:LineTwo'],
      [prefix + '-37/52', 'Ort', u + '/cac:PostalAddress/cbc:CityName', c + '/ram:PostalTradeAddress/ram:CityName'],
      [prefix + '-38/53', 'PLZ', u + '/cac:PostalAddress/cbc:PostalZone', c + '/ram:PostalTradeAddress/ram:PostcodeCode'],
      [prefix + '-40/55', 'Land', u + '/cac:PostalAddress/cac:Country/cbc:IdentificationCode', c + '/ram:PostalTradeAddress/ram:CountryID'],
      [prefix + '-41/56', 'Kontakt', u + '/cac:Contact/cbc:Name', c + '/ram:DefinedTradeContact/ram:PersonName'],
      [prefix + '-42/57', 'Telefon', u + '/cac:Contact/cbc:Telephone', c + '/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber'],
      [prefix + '-43/58', 'E-Mail', u + '/cac:Contact/cbc:ElectronicMail', c + '/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:URIID'],
    ];
  }

  const TOTAL_TERMS = [
    ['BT-106', 'Summe Positionen (netto)', 'cac:LegalMonetaryTotal/cbc:LineExtensionAmount', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:LineTotalAmount'],
    ['BT-107', 'Summe Nachlässe', 'cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:AllowanceTotalAmount'],
    ['BT-108', 'Summe Zuschläge', 'cac:LegalMonetaryTotal/cbc:ChargeTotalAmount', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:ChargeTotalAmount'],
    ['BT-109', 'Gesamtsumme netto', 'cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxBasisTotalAmount'],
    ['BT-110', 'Umsatzsteuer gesamt', "cac:TaxTotal/cbc:TaxAmount[@currencyID = /*/cbc:DocumentCurrencyCode]", 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxTotalAmount[@currencyID = /*/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceCurrencyCode]'],
    ['BT-112', 'Gesamtsumme brutto', 'cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount'],
    ['BT-113', 'Bereits gezahlt', 'cac:LegalMonetaryTotal/cbc:PrepaidAmount', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TotalPrepaidAmount'],
    ['BT-114', 'Rundungsbetrag', 'cac:LegalMonetaryTotal/cbc:PayableRoundingAmount', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:RoundingAmount'],
    ['BT-115', 'Fälliger Betrag', 'cac:LegalMonetaryTotal/cbc:PayableAmount', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:DuePayableAmount'],
  ];

  const PAYMENT_TERMS = [
    ['BT-81', 'Zahlungsart (Code)', 'cac:PaymentMeans/cbc:PaymentMeansCode', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode'],
    ['BT-82', 'Zahlungsart (Text)', 'cac:PaymentMeans/cbc:PaymentMeansCode/@name', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:Information'],
    ['BT-83', 'Verwendungszweck', 'cac:PaymentMeans/cbc:PaymentID', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:PaymentReference'],
    ['BT-84', 'IBAN / Kontonummer', 'cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount/(ram:IBANID | ram:ProprietaryID)'],
    ['BT-85', 'Kontoinhaber', 'cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:Name', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount/ram:AccountName'],
    ['BT-86', 'BIC', 'cac:PaymentMeans/cac:PayeeFinancialAccount/cac:FinancialInstitutionBranch/cbc:ID', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeeSpecifiedCreditorFinancialInstitution/ram:BICID'],
    ['BT-89', 'Mandatsreferenz (Lastschrift)', 'cac:PaymentMeans/cac:PaymentMandate/cbc:ID', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradePaymentTerms/ram:DirectDebitMandateID'],
    ['BT-90', 'Gläubiger-ID', 'cac:PayeeParty/cac:PartyIdentification/cbc:ID[@schemeID=\'SEPA\']', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:CreditorReferenceID'],
    ['BT-91', 'IBAN Zahler (Lastschrift)', 'cac:PaymentMeans/cac:PaymentMandate/cac:PayerFinancialAccount/cbc:ID', 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayerPartyDebtorFinancialAccount/ram:IBANID'],
  ];

  const VAT_UBL = { rows: 'cac:TaxTotal/cac:TaxSubtotal', cat: 'cac:TaxCategory/cbc:ID', rate: 'cac:TaxCategory/cbc:Percent', taxable: 'cbc:TaxableAmount', tax: 'cbc:TaxAmount', reason: 'cac:TaxCategory/cbc:TaxExemptionReason', reasonCode: 'cac:TaxCategory/cbc:TaxExemptionReasonCode' };
  const VAT_CII = { rows: 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax', cat: 'ram:CategoryCode', rate: 'ram:RateApplicablePercent', taxable: 'ram:BasisAmount', tax: 'ram:CalculatedAmount', reason: 'ram:ExemptionReason', reasonCode: 'ram:ExemptionReasonCode' };

  const LINE_UBL = { rows: '(cac:InvoiceLine | cac:CreditNoteLine)', id: 'cbc:ID', name: 'cac:Item/cbc:Name', desc: 'cac:Item/cbc:Description', qty: '(cbc:InvoicedQuantity | cbc:CreditedQuantity)', unit: '(cbc:InvoicedQuantity | cbc:CreditedQuantity)/@unitCode', price: 'cac:Price/cbc:PriceAmount', baseQty: 'cac:Price/cbc:BaseQuantity', net: 'cbc:LineExtensionAmount', vatCat: 'cac:Item/cac:ClassifiedTaxCategory/cbc:ID', vatRate: 'cac:Item/cac:ClassifiedTaxCategory/cbc:Percent', note: 'cbc:Note', sellerId: 'cac:Item/cac:SellersItemIdentification/cbc:ID', period: 'cac:InvoicePeriod/cbc:StartDate', periodEnd: 'cac:InvoicePeriod/cbc:EndDate' };
  const LINE_CII = { rows: 'rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem', id: 'ram:AssociatedDocumentLineDocument/ram:LineID', name: 'ram:SpecifiedTradeProduct/ram:Name', desc: 'ram:SpecifiedTradeProduct/ram:Description', qty: 'ram:SpecifiedLineTradeDelivery/ram:BilledQuantity', unit: 'ram:SpecifiedLineTradeDelivery/ram:BilledQuantity/@unitCode', price: 'ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount', baseQty: 'ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:BasisQuantity', net: 'ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount', vatCat: 'ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode', vatRate: 'ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent', note: 'ram:AssociatedDocumentLineDocument/ram:IncludedNote/ram:Content', sellerId: 'ram:SpecifiedTradeProduct/ram:SellerAssignedID', period: 'ram:SpecifiedLineTradeSettlement/ram:BillingSpecifiedPeriod/ram:StartDateTime/udt:DateTimeString', periodEnd: 'ram:SpecifiedLineTradeSettlement/ram:BillingSpecifiedPeriod/ram:EndDateTime/udt:DateTimeString' };

  const ALLOWANCE_UBL = { rows: 'cac:AllowanceCharge', indicator: 'cbc:ChargeIndicator', amount: 'cbc:Amount', base: 'cbc:BaseAmount', pct: 'cbc:MultiplierFactorNumeric', reason: 'cbc:AllowanceChargeReason', reasonCode: 'cbc:AllowanceChargeReasonCode', vatCat: 'cac:TaxCategory/cbc:ID', vatRate: 'cac:TaxCategory/cbc:Percent' };
  const ALLOWANCE_CII = { rows: 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge', indicator: 'ram:ChargeIndicator/udt:Indicator', amount: 'ram:ActualAmount', base: 'ram:BasisAmount', pct: 'ram:CalculationPercent', reason: 'ram:Reason', reasonCode: 'ram:ReasonCode', vatCat: 'ram:CategoryTradeTax/ram:CategoryCode', vatRate: 'ram:CategoryTradeTax/ram:RateApplicablePercent' };

  const ATTACH_UBL = { rows: 'cac:AdditionalDocumentReference', id: 'cbc:ID', desc: 'cbc:DocumentDescription', type: 'cbc:DocumentTypeCode', file: 'cac:Attachment/cbc:EmbeddedDocumentBinaryObject/@filename', mime: 'cac:Attachment/cbc:EmbeddedDocumentBinaryObject/@mimeCode', uri: 'cac:Attachment/cac:ExternalReference/cbc:URI', size: 'string-length(cac:Attachment/cbc:EmbeddedDocumentBinaryObject)' };
  const ATTACH_CII = { rows: 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:AdditionalReferencedDocument', id: 'ram:IssuerAssignedID', desc: 'ram:Name', type: 'ram:TypeCode', file: 'ram:AttachmentBinaryObject/@filename', mime: 'ram:AttachmentBinaryObject/@mimeCode', uri: 'ram:URIID', size: 'string-length(ram:AttachmentBinaryObject)' };

  function detectSyntax(doc) {
    const r = doc.documentElement;
    if (!r) return null;
    if (r.namespaceURI === NS.ubl && r.localName === 'Invoice') return 'UBL-Invoice';
    if (r.namespaceURI === NS.cn && r.localName === 'CreditNote') return 'UBL-CreditNote';
    if (r.namespaceURI === NS.rsm && r.localName === 'CrossIndustryInvoice') return 'CII';
    if (r.localName === 'CrossIndustryDocument') return 'CII-ZUGFeRD1';
    return null;
  }

  function create(fontoxpath, doc) {
    const syntax = detectSyntax(doc);
    const isUbl = syntax === 'UBL-Invoice' || syntax === 'UBL-CreditNote';
    const opts = { namespaceResolver: (p) => NS[p] || null, language: fontoxpath.evaluateXPath.XPATH_3_1_LANGUAGE };
    const root = doc.documentElement;
    const str = (expr, ctx) => {
      try {
        const v = fontoxpath.evaluateXPathToStrings(expr, ctx || root, null, null, opts);
        return v.map((x) => x.trim()).filter(Boolean).join(' | ');
      } catch (e) { return ''; }
    };
    const nodes = (expr, ctx) => { try { return fontoxpath.evaluateXPathToNodes(expr, ctx || root, null, null, opts); } catch (e) { return []; } };
    const pick = (t) => (isUbl ? t[2] : t[3]);
    const terms = (list) => list.map((t) => ({ id: t[0], label: t[1], value: str(pick(t)) })).filter((x) => x.value !== '');
    const table = (def) => nodes(def.rows).map((row) => { const o = {}; for (const k of Object.keys(def)) if (k !== 'rows') o[k] = str(def[k], row); return o; });

    const model = {
      syntax,
      header: terms(HEADER_TERMS),
      seller: terms(partyTerms('BT', { ubl: SELLER_UBL, cii: SELLER_CII })),
      buyer: terms(partyTerms('BT', { ubl: BUYER_UBL, cii: BUYER_CII })),
      payee: isUbl ? str('cac:PayeeParty/cac:PartyName/cbc:Name') : str('rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:PayeeTradeParty/ram:Name'),
      deliveryParty: isUbl ? str('cac:Delivery/cac:DeliveryParty/cac:PartyName/cbc:Name') : str('rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery/ram:ShipToTradeParty/ram:Name'),
      deliveryAddress: isUbl ? str('string-join(cac:Delivery/cac:DeliveryLocation/cac:Address/(cbc:StreetName, cbc:PostalZone, cbc:CityName, cac:Country/cbc:IdentificationCode), ", ")') : str('string-join(rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery/ram:ShipToTradeParty/ram:PostalTradeAddress/(ram:LineOne, ram:PostcodeCode, ram:CityName, ram:CountryID), ", ")'),
      totals: terms(TOTAL_TERMS),
      payment: terms(PAYMENT_TERMS),
      vat: table(isUbl ? VAT_UBL : VAT_CII),
      lines: table(isUbl ? LINE_UBL : LINE_CII),
      allowances: table(isUbl ? ALLOWANCE_UBL : ALLOWANCE_CII),
      attachments: table(isUbl ? ATTACH_UBL : ATTACH_CII),
      precedingInvoices: isUbl ? nodes('cac:BillingReference/cac:InvoiceDocumentReference').map((n) => ({ id: str('cbc:ID', n), date: str('cbc:IssueDate', n) })) : nodes('rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceReferencedDocument').map((n) => ({ id: str('ram:IssuerAssignedID', n), date: str('ram:FormattedIssueDateTime/qdt:DateTimeString', n) })),
      skonto: [],
      notes: isUbl ? nodes('cbc:Note').map((n) => n.textContent) : nodes('rsm:ExchangedDocument/ram:IncludedNote').map((n) => (str('ram:SubjectCode', n) ? '[' + str('ram:SubjectCode', n) + '] ' : '') + str('ram:Content', n)),
    };
    // Skonto / Verzug lines per XRechnung BR-DE-18 in BT-20
    const terms20 = isUbl ? nodes('cac:PaymentTerms/cbc:Note') : nodes('rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradePaymentTerms/ram:Description');
    for (const n of terms20) {
      for (const line of n.textContent.split(/\r?\n/)) {
        const m = /^#(SKONTO|VERZUG)#TAGE=(\d+)#PROZENT=(\d+\.\d{2})(#BASISBETRAG=(-?\d+\.\d{2}))?#$/.exec(line.trim());
        if (m) model.skonto.push({ type: m[1], days: m[2], percent: m[3], base: m[5] || null });
      }
    }
    return model;
  }

  return { create, detectSyntax, NS };
});
