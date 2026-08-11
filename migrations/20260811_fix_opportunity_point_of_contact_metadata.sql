-- Align Opportunity's standard relation field metadata with the CRM UI label.
-- The table view was reading standardOverrides.label = 关键联系人, while the
-- settings field list was still reading fieldMetadata.label = Point of Contact.

UPDATE core."fieldMetadata" fm
   SET label = '关键联系人',
       "standardOverrides" = COALESCE(fm."standardOverrides", '{}'::jsonb) || jsonb_build_object('label', '关键联系人'),
       "isLabelSyncedWithName" = false,
       "updatedAt" = now()
  FROM core."objectMetadata" om
 WHERE om.id = fm."objectMetadataId"
   AND om."nameSingular" = 'opportunity'
   AND fm.name = 'pointOfContact'
   AND fm."isActive" = true;
