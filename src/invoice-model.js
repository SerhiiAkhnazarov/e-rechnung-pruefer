/*
 * invoice-model.js — reads the business terms of the EN 16931 (BT-/BG- identifiers) from a UBL 2.1 Invoice /
 * CreditNote or a UN/CEFACT CII D16B document with XPath, so that the viewer, the data exports and the check of the
 * Pflichtangaben can show what the invoice says without the user reading XML.
 *
 * The syntax binding follows the KoSIT visualization (xrechnung-visualization, stylesheets ubl-invoice-xr.xsl,
 * ubl-creditnote-xr.xsl, cii-xr.xsl): test/run-invoice-model-tests.cjs compares every value of this model with the
 * KoSIT semantic-model instance of each corpus document (Saxon HE 12.8).
 *
 * Output: the groups for display (header, seller, buyer, …, lines) and `bt`: every business term read, in document
 * order — { 'BT-1': ['RE-4711'], 'BT-131': ['100.00', '20.00'], … }. Dates of CII (format 102, YYYYMMDD) are given as
 * YYYY-MM-DD like in UBL; other values exactly as in the document (whitespace normalised).
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

  // date terms: CII 102 (YYYYMMDD) -> YYYY-MM-DD
  const DATE_TERMS = new Set(['BT-2', 'BT-7', 'BT-9', 'BT-26', 'BT-72', 'BT-73', 'BT-74', 'BT-134', 'BT-135']);
  const uniq = (a) => [...new Set(a)];
  const isoDate = (v) => { const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v); return m ? m[1] + '-' + m[2] + '-' + m[3] : v; };

  // ---------------------------------------------------------------------------------------------------------------
  // binding: [id, label, UBL XPath, CII XPath] — relative to the group node (the root element for the document level).
  // UBL paths serve Invoice and CreditNote (the few differences as unions). '' = not bound in this syntax.
  // ---------------------------------------------------------------------------------------------------------------
  const STL = 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement';
  const AGR = 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement';
  const DLV = 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery';
  const HEADER = [
    ['BT-1', 'Rechnungsnummer', 'cbc:ID', 'rsm:ExchangedDocument/ram:ID'],
    ['BT-2', 'Rechnungsdatum', 'cbc:IssueDate', 'rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString'],
    ['BT-3', 'Rechnungsart (Code)', '(cbc:InvoiceTypeCode | cbc:CreditNoteTypeCode)', 'rsm:ExchangedDocument/ram:TypeCode'],
    ['BT-5', 'Währung', 'cbc:DocumentCurrencyCode', STL + '/ram:InvoiceCurrencyCode'],
    ['BT-6', 'Umsatzsteuer-Abrechnungswährung', 'cbc:TaxCurrencyCode', STL + '/ram:TaxCurrencyCode'],
    ['BT-7', 'Steuerzeitpunkt (Abrechnungsdatum der Umsatzsteuer)', 'cbc:TaxPointDate', STL + '/ram:ApplicableTradeTax/ram:TaxPointDate/udt:DateString'],
    ['BT-8', 'Code des Steuerzeitpunkts', 'cac:InvoicePeriod/cbc:DescriptionCode', STL + '/ram:ApplicableTradeTax/ram:DueDateTypeCode'],
    ['BT-9', 'Fälligkeitsdatum', '(cbc:DueDate | cac:PaymentMeans/cbc:PaymentDueDate)', STL + '/ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString'],
    ['BT-10', 'Käuferreferenz (Leitweg-ID)', 'cbc:BuyerReference', AGR + '/ram:BuyerReference'],
    ['BT-11', 'Projektreferenz', '(cac:ProjectReference/cbc:ID | cac:AdditionalDocumentReference[/cn:CreditNote]/cbc:ID[following-sibling::cbc:DocumentTypeCode = \'50\'])', AGR + '/ram:SpecifiedProcuringProject/ram:ID'],
    ['BT-12', 'Vertragsnummer', 'cac:ContractDocumentReference/cbc:ID', AGR + '/ram:ContractReferencedDocument/ram:IssuerAssignedID'],
    ['BT-13', 'Bestellnummer', 'cac:OrderReference/cbc:ID', AGR + '/ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID'],
    ['BT-14', 'Auftragsnummer (Verkäufer)', 'cac:OrderReference/cbc:SalesOrderID', AGR + '/ram:SellerOrderReferencedDocument/ram:IssuerAssignedID'],
    ['BT-15', 'Wareneingangsmeldung', 'cac:ReceiptDocumentReference/cbc:ID', DLV + '/ram:ReceivingAdviceReferencedDocument/ram:IssuerAssignedID'],
    ['BT-16', 'Lieferscheinnummer', 'cac:DespatchDocumentReference/cbc:ID', DLV + '/ram:DespatchAdviceReferencedDocument/ram:IssuerAssignedID'],
    ['BT-17', 'Vergabenummer (Ausschreibung/Los)', 'cac:OriginatorDocumentReference/cbc:ID', AGR + '/ram:AdditionalReferencedDocument/ram:IssuerAssignedID[following-sibling::ram:TypeCode = \'50\']'],
    ['BT-18', 'Objektkennung', 'cac:AdditionalDocumentReference/cbc:ID[following-sibling::cbc:DocumentTypeCode = \'130\']', AGR + '/ram:AdditionalReferencedDocument/ram:IssuerAssignedID[following-sibling::ram:TypeCode = \'130\']'],
    ['BT-19', 'Buchungsreferenz des Käufers', 'cbc:AccountingCost', STL + '/ram:ReceivableSpecifiedTradeAccountingAccount/ram:ID'],
    ['BT-20', 'Zahlungsbedingungen', 'cac:PaymentTerms/cbc:Note', STL + '/ram:SpecifiedTradePaymentTerms/ram:Description'],
    ['BT-23', 'Geschäftsprozess', 'cbc:ProfileID', 'rsm:ExchangedDocumentContext/ram:BusinessProcessSpecifiedDocumentContextParameter/ram:ID'],
    ['BT-24', 'Spezifikationskennung', 'cbc:CustomizationID', 'rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID'],
    ['BT-72', 'Liefer-/Leistungsdatum', 'cac:Delivery/cbc:ActualDeliveryDate', DLV + '/ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime/udt:DateTimeString'],
    ['BT-73', 'Leistungszeitraum von', 'cac:InvoicePeriod/cbc:StartDate', STL + '/ram:BillingSpecifiedPeriod/ram:StartDateTime/udt:DateTimeString'],
    ['BT-74', 'Leistungszeitraum bis', 'cac:InvoicePeriod/cbc:EndDate', STL + '/ram:BillingSpecifiedPeriod/ram:EndDateTime/udt:DateTimeString'],
  ];

  const address = (pfx, ids) => [
    [ids[0], 'Straße / Adresszeile 1', pfx[0] + 'cbc:StreetName', pfx[1] + 'ram:LineOne'],
    [ids[1], 'Adresszeile 2', pfx[0] + 'cbc:AdditionalStreetName', pfx[1] + 'ram:LineTwo'],
    [ids[2], 'Adresszeile 3', pfx[0] + 'cac:AddressLine/cbc:Line', pfx[1] + 'ram:LineThree'],
    [ids[3], 'Ort', pfx[0] + 'cbc:CityName', pfx[1] + 'ram:CityName'],
    [ids[4], 'PLZ', pfx[0] + 'cbc:PostalZone', pfx[1] + 'ram:PostcodeCode'],
    [ids[5], 'Region / Bundesland', pfx[0] + 'cbc:CountrySubentity', pfx[1] + 'ram:CountrySubDivisionName'],
    [ids[6], 'Land', pfx[0] + 'cac:Country/cbc:IdentificationCode', pfx[1] + 'ram:CountryID'],
  ];
  const SELLER = {
    ubl: 'cac:AccountingSupplierParty/cac:Party', cii: AGR + '/ram:SellerTradeParty',
    terms: [
      ['BT-27', 'Name', 'cac:PartyLegalEntity/cbc:RegistrationName', 'ram:Name'],
      ['BT-28', 'Handelsname', 'cac:PartyName/cbc:Name', 'ram:SpecifiedLegalOrganization/ram:TradingBusinessName'],
      ['BT-29', 'Kennung', 'cac:PartyIdentification/cbc:ID[not(@schemeID = \'SEPA\')]', '(ram:ID | ram:GlobalID[exists(@schemeID)])'],
      ['BT-30', 'Registernummer', 'cac:PartyLegalEntity/cbc:CompanyID', 'ram:SpecifiedLegalOrganization/ram:ID'],
      ['BT-31', 'USt-IdNr.', 'cac:PartyTaxScheme/cbc:CompanyID[following-sibling::cac:TaxScheme/cbc:ID = \'VAT\']', 'ram:SpecifiedTaxRegistration/ram:ID[@schemeID = \'VA\']'],
      ['BT-32', 'Steuernummer', 'cac:PartyTaxScheme/cbc:CompanyID[following-sibling::cac:TaxScheme/cbc:ID != \'VAT\']', 'ram:SpecifiedTaxRegistration/ram:ID[@schemeID = \'FC\']'],
      ['BT-33', 'Weitere rechtliche Angaben', 'cac:PartyLegalEntity/cbc:CompanyLegalForm', 'ram:Description'],
      ['BT-34', 'Elektronische Adresse', 'cbc:EndpointID', 'ram:URIUniversalCommunication/ram:URIID'],
    ].concat(address(['cac:PostalAddress/', 'ram:PostalTradeAddress/'], ['BT-35', 'BT-36', 'BT-162', 'BT-37', 'BT-38', 'BT-39', 'BT-40']), [
      ['BT-41', 'Kontakt', 'cac:Contact/cbc:Name', 'for $c in ram:DefinedTradeContact return ($c/ram:DepartmentName, $c/ram:PersonName)'],
      ['BT-42', 'Telefon', 'cac:Contact/cbc:Telephone', 'ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber'],
      ['BT-43', 'E-Mail', 'cac:Contact/cbc:ElectronicMail', 'ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:URIID'],
    ]),
  };
  const BUYER = {
    ubl: 'cac:AccountingCustomerParty/cac:Party', cii: AGR + '/ram:BuyerTradeParty',
    terms: [
      ['BT-44', 'Name', 'cac:PartyLegalEntity/cbc:RegistrationName', 'ram:Name'],
      ['BT-45', 'Handelsname', 'cac:PartyName/cbc:Name', 'ram:SpecifiedLegalOrganization/ram:TradingBusinessName'],
      ['BT-46', 'Kennung', 'cac:PartyIdentification/cbc:ID', '(ram:ID[empty(following-sibling::ram:GlobalID/@schemeID)] | ram:GlobalID[exists(@schemeID)])'],
      ['BT-47', 'Registernummer', 'cac:PartyLegalEntity/cbc:CompanyID', 'ram:SpecifiedLegalOrganization/ram:ID'],
      ['BT-48', 'USt-IdNr.', 'cac:PartyTaxScheme/cbc:CompanyID[following-sibling::cac:TaxScheme/cbc:ID = \'VAT\']', 'ram:SpecifiedTaxRegistration/ram:ID[@schemeID = (\'VA\', \'VAT\')]'],
      ['BT-49', 'Elektronische Adresse', 'cbc:EndpointID', 'ram:URIUniversalCommunication/ram:URIID'],
    ].concat(address(['cac:PostalAddress/', 'ram:PostalTradeAddress/'], ['BT-50', 'BT-51', 'BT-163', 'BT-52', 'BT-53', 'BT-54', 'BT-55']), [
      ['BT-56', 'Kontakt', 'cac:Contact/cbc:Name', 'for $c in ram:DefinedTradeContact return ($c/ram:DepartmentName, $c/ram:PersonName)'],
      ['BT-57', 'Telefon', 'cac:Contact/cbc:Telephone', 'ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber'],
      ['BT-58', 'E-Mail', 'cac:Contact/cbc:ElectronicMail', 'ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:URIID'],
    ]),
  };
  const PAYEE = {
    ubl: 'cac:PayeeParty', cii: STL + '/ram:PayeeTradeParty',
    terms: [
      ['BT-59', 'Name', 'cac:PartyName/cbc:Name', 'ram:Name'],
      ['BT-60', 'Kennung', 'cac:PartyIdentification/cbc:ID[not(@schemeID = \'SEPA\')]', '(ram:ID | ram:GlobalID[exists(@schemeID)])'],
      ['BT-61', 'Registernummer', 'cac:PartyLegalEntity/cbc:CompanyID', 'ram:SpecifiedLegalOrganization/ram:ID'],
    ],
  };
  const TAXREP = {
    ubl: 'cac:TaxRepresentativeParty', cii: AGR + '/ram:SellerTaxRepresentativeTradeParty',
    terms: [
      ['BT-62', 'Name', 'cac:PartyName/cbc:Name', 'ram:Name'],
      ['BT-63', 'USt-IdNr.', 'cac:PartyTaxScheme/cbc:CompanyID[following-sibling::cac:TaxScheme/cbc:ID = \'VAT\']', 'ram:SpecifiedTaxRegistration/ram:ID'],
    ].concat(address(['cac:PostalAddress/', 'ram:PostalTradeAddress/'], ['BT-64', 'BT-65', 'BT-164', 'BT-66', 'BT-67', 'BT-68', 'BT-69'])),
  };
  const DELIVERY = {
    ubl: 'cac:Delivery', cii: DLV,
    terms: [
      ['BT-70', 'Name des Lieferempfängers', 'cac:DeliveryParty/cac:PartyName/cbc:Name', 'ram:ShipToTradeParty/ram:Name'],
      ['BT-71', 'Kennung des Lieferorts', 'cac:DeliveryLocation/cbc:ID', 'ram:ShipToTradeParty/(ram:ID | ram:GlobalID[exists(@schemeID)])'],
    ].concat(address(['cac:DeliveryLocation/cac:Address/', 'ram:ShipToTradeParty/ram:PostalTradeAddress/'], ['BT-75', 'BT-76', 'BT-165', 'BT-77', 'BT-78', 'BT-79', 'BT-80'])),
  };

  const TOTALS = [
    ['BT-106', 'Summe der Positionen (netto)', 'cac:LegalMonetaryTotal/cbc:LineExtensionAmount', STL + '/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:LineTotalAmount'],
    ['BT-107', 'Summe der Nachlässe', 'cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount', STL + '/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:AllowanceTotalAmount'],
    ['BT-108', 'Summe der Zuschläge', 'cac:LegalMonetaryTotal/cbc:ChargeTotalAmount', STL + '/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:ChargeTotalAmount'],
    ['BT-109', 'Gesamtbetrag ohne Umsatzsteuer', 'cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount', STL + '/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxBasisTotalAmount'],
    ['BT-110', 'Umsatzsteuer gesamt', 'cac:TaxTotal/cbc:TaxAmount[@currencyID = /*/cbc:DocumentCurrencyCode]', STL + '/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxTotalAmount[@currencyID = ../../ram:InvoiceCurrencyCode]'],
    ['BT-111', 'Umsatzsteuer gesamt in Abrechnungswährung', 'cac:TaxTotal/cbc:TaxAmount[@currencyID = /*/cbc:TaxCurrencyCode]', STL + '/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxTotalAmount[@currencyID = ../../ram:TaxCurrencyCode]'],
    ['BT-112', 'Gesamtbetrag einschließlich Umsatzsteuer', 'cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount', STL + '/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount'],
    ['BT-113', 'Bereits gezahlt', 'cac:LegalMonetaryTotal/cbc:PrepaidAmount', STL + '/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TotalPrepaidAmount'],
    ['BT-114', 'Rundungsbetrag', 'cac:LegalMonetaryTotal/cbc:PayableRoundingAmount', STL + '/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:RoundingAmount'],
    ['BT-115', 'Fälliger Betrag', 'cac:LegalMonetaryTotal/cbc:PayableAmount', STL + '/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:DuePayableAmount'],
  ];

  const PAYMENT = [
    ['BT-81', 'Zahlungsart (Code)', 'cac:PaymentMeans/cbc:PaymentMeansCode', STL + '/ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode'],
    ['BT-82', 'Zahlungsart (Text)', 'cac:PaymentMeans/cbc:PaymentMeansCode/@name', STL + '/ram:SpecifiedTradeSettlementPaymentMeans/ram:Information'],
    ['BT-83', 'Verwendungszweck', 'cac:PaymentMeans/cbc:PaymentID', STL + '/ram:PaymentReference[../ram:SpecifiedTradeSettlementPaymentMeans]'],
    ['BT-84', 'IBAN / Kontonummer', 'cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID', 'for $a in ' + STL + '/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount return ($a/ram:ProprietaryID, $a/ram:IBANID)'],
    ['BT-85', 'Kontoinhaber', 'cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:Name', STL + '/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount/ram:AccountName'],
    ['BT-86', 'BIC', 'cac:PaymentMeans/cac:PayeeFinancialAccount/cac:FinancialInstitutionBranch/cbc:ID', STL + '/ram:SpecifiedTradeSettlementPaymentMeans[ram:PayeePartyCreditorFinancialAccount]/ram:PayeeSpecifiedCreditorFinancialInstitution/ram:BICID'],
    ['BT-87', 'Kartennummer (gekürzt)', 'cac:PaymentMeans/cac:CardAccount/cbc:PrimaryAccountNumberID', STL + '/ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:ID'],
    ['BT-88', 'Karteninhaber', 'cac:PaymentMeans/cac:CardAccount/cbc:HolderName', STL + '/ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:CardholderName'],
    ['BT-89', 'Mandatsreferenz (Lastschrift)', 'cac:PaymentMeans/cac:PaymentMandate/cbc:ID', STL + '/ram:SpecifiedTradePaymentTerms/ram:DirectDebitMandateID'],
    ['BT-90', 'Gläubiger-ID', '(cac:PayeeParty | cac:AccountingSupplierParty/cac:Party)/cac:PartyIdentification/cbc:ID[@schemeID = \'SEPA\'][/*/cac:PaymentMeans/cac:PaymentMandate]', STL + '/ram:CreditorReferenceID'],
    ['BT-91', 'IBAN des Zahlers (Lastschrift)', 'cac:PaymentMeans/cac:PaymentMandate/cac:PayerFinancialAccount/cbc:ID', STL + '/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayerPartyDebtorFinancialAccount/ram:IBANID'],
  ];

  // repeating groups: rows + [field, id, UBL, CII] relative to the row
  const VAT = {
    ubl: 'cac:TaxTotal/cac:TaxSubtotal', cii: STL + '/ram:ApplicableTradeTax',
    fields: [['taxable', 'BT-116', 'cbc:TaxableAmount', 'ram:BasisAmount'], ['tax', 'BT-117', 'cbc:TaxAmount', 'ram:CalculatedAmount'], ['cat', 'BT-118', 'cac:TaxCategory/cbc:ID[following-sibling::cac:TaxScheme/cbc:ID = \'VAT\']', 'ram:CategoryCode'], ['rate', 'BT-119', 'cac:TaxCategory/cbc:Percent', 'ram:RateApplicablePercent'], ['reason', 'BT-120', 'cac:TaxCategory/cbc:TaxExemptionReason', 'ram:ExemptionReason'], ['reasonCode', 'BT-121', 'cac:TaxCategory/cbc:TaxExemptionReasonCode', 'ram:ExemptionReasonCode']],
  };
  const allowanceFields = (ids) => [['amount', ids[0], 'cbc:Amount', 'ram:ActualAmount'], ['base', ids[1], 'cbc:BaseAmount', 'ram:BasisAmount'], ['pct', ids[2], 'cbc:MultiplierFactorNumeric', 'ram:CalculationPercent'], ['vatCat', ids[3], 'cac:TaxCategory/cbc:ID[following-sibling::cac:TaxScheme/cbc:ID = \'VAT\']', 'ram:CategoryTradeTax/ram:CategoryCode'], ['vatRate', ids[4], 'cac:TaxCategory/cbc:Percent', 'ram:CategoryTradeTax/ram:RateApplicablePercent'], ['reason', ids[5], 'cbc:AllowanceChargeReason', 'ram:Reason'], ['reasonCode', ids[6], 'cbc:AllowanceChargeReasonCode', 'ram:ReasonCode']].filter((f) => f[1]);
  const DOC_ALLOWANCE = { ubl: 'cac:AllowanceCharge[cbc:ChargeIndicator = \'false\']', cii: STL + '/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator = \'false\']', fields: allowanceFields(['BT-92', 'BT-93', 'BT-94', 'BT-95', 'BT-96', 'BT-97', 'BT-98']) };
  const DOC_CHARGE = { ubl: 'cac:AllowanceCharge[cbc:ChargeIndicator = \'true\']', cii: STL + '/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator = \'true\']', fields: allowanceFields(['BT-99', 'BT-100', 'BT-101', 'BT-102', 'BT-103', 'BT-104', 'BT-105']) };
  const PRECEDING = { ubl: 'cac:BillingReference/cac:InvoiceDocumentReference', cii: STL + '/ram:InvoiceReferencedDocument', fields: [['id', 'BT-25', 'cbc:ID', 'ram:IssuerAssignedID'], ['date', 'BT-26', 'cbc:IssueDate', 'ram:FormattedIssueDateTime/qdt:DateTimeString']] };
  const ATTACHMENTS = {
    // as KoSIT: every document reference is a BG-24; in CII the reference number counts as BT-122 only with TypeCode 916
    ubl: 'cac:AdditionalDocumentReference[not(/cn:CreditNote and cbc:DocumentTypeCode = \'50\')]', cii: AGR + '/ram:AdditionalReferencedDocument',
    fields: [['id', 'BT-122', 'cbc:ID', 'ram:IssuerAssignedID[following-sibling::ram:TypeCode = \'916\']'], ['desc', 'BT-123', 'cbc:DocumentDescription', 'ram:Name'], ['uri', 'BT-124', 'cac:Attachment/cac:ExternalReference/cbc:URI', 'ram:URIID'], ['file', '', 'cac:Attachment/cbc:EmbeddedDocumentBinaryObject/@filename', 'ram:AttachmentBinaryObject/@filename'], ['mime', '', 'cac:Attachment/cbc:EmbeddedDocumentBinaryObject/@mimeCode', 'ram:AttachmentBinaryObject/@mimeCode'], ['type', '', 'cbc:DocumentTypeCode', 'ram:TypeCode']],
    binary: ['cac:Attachment/cbc:EmbeddedDocumentBinaryObject', 'ram:AttachmentBinaryObject'],
  };
  const NOTES = { ubl: 'cbc:Note', cii: 'rsm:ExchangedDocument/ram:IncludedNote' };

  const LINE = {
    ubl: '(cac:InvoiceLine | cac:CreditNoteLine)', cii: 'rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem',
    fields: [
      ['id', 'BT-126', 'cbc:ID', 'ram:AssociatedDocumentLineDocument/ram:LineID'],
      ['note', 'BT-127', 'cbc:Note', 'ram:AssociatedDocumentLineDocument/ram:IncludedNote/ram:Content'],
      ['objectId', 'BT-128', 'cac:DocumentReference[cbc:DocumentTypeCode = \'130\']/cbc:ID', 'ram:SpecifiedLineTradeSettlement/ram:AdditionalReferencedDocument[ram:TypeCode = \'130\']/ram:IssuerAssignedID'],
      ['qty', 'BT-129', '(cbc:InvoicedQuantity | cbc:CreditedQuantity)', 'ram:SpecifiedLineTradeDelivery/ram:BilledQuantity'],
      ['unit', 'BT-130', '(cbc:InvoicedQuantity | cbc:CreditedQuantity)/@unitCode', 'ram:SpecifiedLineTradeDelivery/ram:BilledQuantity/@unitCode'],
      ['net', 'BT-131', 'cbc:LineExtensionAmount', 'ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount'],
      ['orderLine', 'BT-132', 'cac:OrderLineReference/cbc:LineID', 'ram:SpecifiedLineTradeAgreement/ram:BuyerOrderReferencedDocument/ram:LineID'],
      ['accounting', 'BT-133', 'cbc:AccountingCost', 'ram:SpecifiedLineTradeSettlement/ram:ReceivableSpecifiedTradeAccountingAccount/ram:ID'],
      ['period', 'BT-134', 'cac:InvoicePeriod/cbc:StartDate', 'ram:SpecifiedLineTradeSettlement/ram:BillingSpecifiedPeriod/ram:StartDateTime/udt:DateTimeString'],
      ['periodEnd', 'BT-135', 'cac:InvoicePeriod/cbc:EndDate', 'ram:SpecifiedLineTradeSettlement/ram:BillingSpecifiedPeriod/ram:EndDateTime/udt:DateTimeString'],
      ['price', 'BT-146', 'cac:Price/cbc:PriceAmount', 'ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount'],
      ['discount', 'BT-147', 'cac:Price/cac:AllowanceCharge/cbc:Amount[preceding-sibling::cbc:ChargeIndicator = \'false\']', 'ram:SpecifiedLineTradeAgreement/ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ActualAmount'],
      ['grossPrice', 'BT-148', 'cac:Price/cac:AllowanceCharge/cbc:BaseAmount[preceding-sibling::cbc:ChargeIndicator = \'false\']', 'ram:SpecifiedLineTradeAgreement/ram:GrossPriceProductTradePrice/ram:ChargeAmount'],
      ['baseQty', 'BT-149', 'cac:Price/cbc:BaseQuantity', '(ram:SpecifiedLineTradeAgreement/ram:GrossPriceProductTradePrice/ram:BasisQuantity, ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:BasisQuantity)[1]'],
      ['baseUnit', 'BT-150', 'cac:Price/cbc:BaseQuantity/@unitCode', '(ram:SpecifiedLineTradeAgreement/ram:GrossPriceProductTradePrice/ram:BasisQuantity/@unitCode, ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:BasisQuantity/@unitCode)[1]'],
      ['vatCat', 'BT-151', 'cac:Item/cac:ClassifiedTaxCategory/cbc:ID', 'ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode'],
      ['vatRate', 'BT-152', 'cac:Item/cac:ClassifiedTaxCategory/cbc:Percent', 'ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent'],
      ['name', 'BT-153', 'cac:Item/cbc:Name', 'ram:SpecifiedTradeProduct/ram:Name'],
      ['desc', 'BT-154', 'cac:Item/cbc:Description', 'ram:SpecifiedTradeProduct/ram:Description'],
      ['sellerId', 'BT-155', 'cac:Item/cac:SellersItemIdentification/cbc:ID', 'ram:SpecifiedTradeProduct/ram:SellerAssignedID'],
      ['buyerId', 'BT-156', 'cac:Item/cac:BuyersItemIdentification/cbc:ID', 'ram:SpecifiedTradeProduct/ram:BuyerAssignedID'],
      ['standardId', 'BT-157', 'cac:Item/cac:StandardItemIdentification/cbc:ID', 'ram:SpecifiedTradeProduct/ram:GlobalID'],
      ['classification', 'BT-158', 'cac:Item/cac:CommodityClassification/cbc:ItemClassificationCode', 'ram:SpecifiedTradeProduct/ram:DesignatedProductClassification/ram:ClassCode'],
      ['origin', 'BT-159', 'cac:Item/cac:OriginCountry/cbc:IdentificationCode', 'ram:SpecifiedTradeProduct/ram:OriginTradeCountry/ram:ID'],
    ],
    allowances: { ubl: 'cac:AllowanceCharge[cbc:ChargeIndicator = \'false\']', cii: 'ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator = \'false\']', fields: [['amount', 'BT-136', 'cbc:Amount', 'ram:ActualAmount'], ['base', 'BT-137', 'cbc:BaseAmount', 'ram:BasisAmount'], ['pct', 'BT-138', 'cbc:MultiplierFactorNumeric', 'ram:CalculationPercent'], ['reason', 'BT-139', 'cbc:AllowanceChargeReason', 'ram:Reason'], ['reasonCode', 'BT-140', 'cbc:AllowanceChargeReasonCode', 'ram:ReasonCode']] },
    charges: { ubl: 'cac:AllowanceCharge[cbc:ChargeIndicator = \'true\']', cii: 'ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator = \'true\']', fields: [['amount', 'BT-141', 'cbc:Amount', 'ram:ActualAmount'], ['base', 'BT-142', 'cbc:BaseAmount', 'ram:BasisAmount'], ['pct', 'BT-143', 'cbc:MultiplierFactorNumeric', 'ram:CalculationPercent'], ['reason', 'BT-144', 'cbc:AllowanceChargeReason', 'ram:Reason'], ['reasonCode', 'BT-145', 'cbc:AllowanceChargeReasonCode', 'ram:ReasonCode']] },
    attributes: { ubl: 'cac:Item/cac:AdditionalItemProperty', cii: 'ram:SpecifiedTradeProduct/ram:ApplicableProductCharacteristic', fields: [['name', 'BT-160', 'cbc:Name', 'ram:Description'], ['value', 'BT-161', 'cbc:Value', 'ram:Value']] },
  };

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
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    const strings = (expr, ctx) => {
      if (!expr) return [];
      try { return fontoxpath.evaluateXPathToStrings(expr, ctx || root, null, null, opts).map(norm).filter((x) => x !== ''); } catch (e) { return []; }
    };
    const nodes = (expr, ctx) => { if (!expr) return []; try { return fontoxpath.evaluateXPathToNodes(expr, ctx || root, null, null, opts); } catch (e) { return []; } };
    const pick = (t) => (isUbl ? t[2] : t[3]);
    // CII dates: udt:DateTimeString / udt:DateString / qdt:DateTimeString with @format; the EN 16931 binding uses 102
    // (YYYYMMDD), given here as YYYY-MM-DD; any other value is kept as written, with its format
    const ciiDates = (expr, ctx) => nodes(expr, ctx).map((n) => {
      const v = norm(n.textContent), fmt = n.getAttribute ? n.getAttribute('format') : null;
      if (v === '') return '';
      if (fmt === '102') return /^\d{8}$/.test(v) ? isoDate(v) : v; // the right format, an unreadable value: as written
      return v + ' (Format ' + (fmt || 'fehlt') + ')';
    }).filter((x) => x !== '');
    const values = (id, expr, ctx) => (!isUbl && DATE_TERMS.has(id) ? ciiDates(expr, ctx) : strings(expr, ctx));
    const bt = {};
    const record = (id, values) => { if (!id || !values.length) return; (bt[id] || (bt[id] = [])).push(...values); };
    /** terms of one node: [{id, label, value}] (several values of one term joined by ' | ') */
    const terms = (list, ctx) => list.map((t) => {
      // document-level terms occur once in the EN 16931; repetitions of the syntax (CII: BT-7 in every tax breakdown) count once
      const vals = uniq(values(t[0], pick(t), ctx));
      record(t[0], vals);
      return { id: t[0], label: t[1], value: vals.join(' | ') };
    }).filter((x) => x.value !== '');
    const group = (def) => { const n = nodes(isUbl ? def.ubl : def.cii)[0]; return n ? terms(def.terms, n) : []; };
    const rows = (def, ctx) => nodes(isUbl ? def.ubl : def.cii, ctx).map((row) => {
      const o = {};
      for (const f of def.fields) {
        const vals = values(f[1], isUbl ? f[2] : f[3], row);
        record(f[1], vals);
        o[f[0]] = vals.join(' | ');
      }
      Object.defineProperty(o, 'node', { value: row, enumerable: false });
      return o;
    });

    const header = terms(HEADER);
    // notes (BG-1): UBL cbc:Note, with the KoSIT convention of a subject code note ('ABC') followed by its text
    const notes = [];
    if (isUbl) {
      const ns = nodes(NOTES.ubl);
      for (let i = 0; i < ns.length; i++) {
        const v = norm(ns[i].textContent);
        if (/^[A-Z]{3}$/.test(v) && i + 1 < ns.length) { record('BT-21', [v]); const t = norm(ns[i + 1].textContent); record('BT-22', t ? [t] : []); notes.push({ subject: v, text: t }); i++; }
        else if (v) { record('BT-22', [v]); notes.push({ subject: '', text: v }); }
      }
    } else {
      for (const n of nodes(NOTES.cii)) {
        const subject = strings('ram:SubjectCode', n).join(' '); record('BT-21', subject ? [subject] : []);
        const text = strings('ram:Content', n).join(' | '); record('BT-22', text ? [text] : []);
        notes.push({ subject, text });
      }
    }
    const seller = group(SELLER);
    const buyer = group(BUYER);
    const payeeParty = group(PAYEE);
    const taxRep = group(TAXREP);
    const delivery = group(DELIVERY);
    const totals = terms(TOTALS);
    const payment = terms(PAYMENT);
    const vat = rows(VAT);
    const allowances = rows(DOC_ALLOWANCE).map((r) => Object.assign(r, { indicator: 'false' })).concat(rows(DOC_CHARGE).map((r) => Object.assign(r, { indicator: 'true' })));
    const precedingInvoices = rows(PRECEDING);
    const attachments = rows(ATTACHMENTS).map((a) => {
      const bins = nodes(isUbl ? ATTACHMENTS.binary[0] : ATTACHMENTS.binary[1], a.node);
      record('BT-125', bins.map((b) => b.textContent.replace(/\s+/g, '')).filter(Boolean));
      const bin = bins[0];
      const data = bin ? bin.textContent.replace(/\s+/g, '') : '';
      a.size = String(data.length);
      Object.defineProperty(a, 'base64', { value: data, enumerable: false });
      return a;
    });
    const lines = rows(LINE).map((l) => {
      l.allowances = rows(LINE.allowances, l.node).map((r) => Object.assign(r, { indicator: 'false' })).concat(rows(LINE.charges, l.node).map((r) => Object.assign(r, { indicator: 'true' })));
      l.attributes = rows(LINE.attributes, l.node);
      return l;
    });
    const nameOf = (list, id) => (list.find((t) => t.id === id) || {}).value || '';
    const model = {
      syntax,
      header,
      seller,
      buyer,
      payeeParty,
      taxRep,
      delivery,
      // compact strings of earlier versions (display)
      payee: nameOf(payeeParty, 'BT-59'),
      deliveryParty: nameOf(delivery, 'BT-70'),
      deliveryAddress: ['BT-75', 'BT-78', 'BT-77', 'BT-80'].map((id) => nameOf(delivery, id)).filter(Boolean).join(', '),
      totals,
      payment,
      vat,
      allowances,
      lines,
      attachments,
      precedingInvoices,
      skonto: [],
      notes: notes.map((n) => (n.subject ? '[' + n.subject + '] ' : '') + n.text),
      bt,
    };
    // Skonto / Verzug lines in BT-20 (XRechnung, BR-DE-18): #SKONTO#TAGE=n#PROZENT=n.nn[#BASISBETRAG=n.nn]#
    for (const n of nodes(isUbl ? 'cac:PaymentTerms/cbc:Note' : STL + '/ram:SpecifiedTradePaymentTerms/ram:Description')) {
      for (const line of n.textContent.split(/\r?\n/)) {
        const m = /^#(SKONTO|VERZUG)#TAGE=(\d+)#PROZENT=(\d+\.\d{2})(#BASISBETRAG=(-?\d+\.\d{2}))?#$/.exec(line.trim());
        if (m) model.skonto.push({ type: m[1], days: m[2], percent: m[3], base: m[5] || null });
      }
    }
    return model;
  }

  /** the business terms this model reads (for the comparison with the KoSIT visualization) */
  const COVERED = new Set([].concat(HEADER, SELLER.terms, BUYER.terms, PAYEE.terms, TAXREP.terms, DELIVERY.terms, TOTALS, PAYMENT).map((t) => t[0])
    .concat([VAT, DOC_ALLOWANCE, DOC_CHARGE, PRECEDING, ATTACHMENTS, LINE, LINE.allowances, LINE.charges, LINE.attributes].flatMap((d) => d.fields.map((f) => f[1])))
    .concat(['BT-21', 'BT-22', 'BT-125']).filter(Boolean));

  return { create, detectSyntax, NS, COVERED, DATE_TERMS };
});
