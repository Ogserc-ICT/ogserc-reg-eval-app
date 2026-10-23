-- AlterTable
ALTER TABLE "OwnUseNotification" ADD COLUMN     "pricedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "pricedFee" BIGINT NOT NULL,
ADD COLUMN     "pricedThresholdKw" INTEGER NOT NULL;


-- Own-use pricing snapshot: changes only inside an admin recalculation
-- (`SET LOCAL ogserc.reprice = 'on'`, src/server/own-use.ts).
CREATE FUNCTION ogserc_own_use_pricing_locked() RETURNS trigger AS $$
BEGIN
  IF (NEW."pricedFee" IS DISTINCT FROM OLD."pricedFee"
      OR NEW."pricedThresholdKw" IS DISTINCT FROM OLD."pricedThresholdKw"
      OR NEW."pricedAt" IS DISTINCT FROM OLD."pricedAt")
     AND coalesce(current_setting('ogserc.reprice', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Pricing snapshot of % can only change through an admin recalculation', OLD."ounNo";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OwnUseNotification_pricing_locked" BEFORE UPDATE ON "OwnUseNotification"
  FOR EACH ROW EXECUTE FUNCTION ogserc_own_use_pricing_locked();

-- Own-use notifications are never deleted either.
CREATE TRIGGER "OwnUseNotification_no_delete" BEFORE DELETE ON "OwnUseNotification"
  FOR EACH ROW EXECUTE FUNCTION ogserc_reject_change();
