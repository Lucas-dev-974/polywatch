import { MigrationInterface, QueryRunner } from 'typeorm';
import { MarketClassifier } from '../market/classifier.js';

export class AddMarketType1700000000031 implements MigrationInterface {
  name = 'AddMarketType1700000000031';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ajouter la colonne (nullable pour la migration, avec valeur par défaut)
    await queryRunner.query(`
      ALTER TABLE markets ADD COLUMN market_type text DEFAULT 'standard';
    `);

    // 2. Backfill : classifier tous les marchés existants
    //    (Correction §9.4 : ORDER BY condition_id pour un ordre déterministe)
    //    (Correction §9.5 : utilisation de la syntaxe PostgreSQL native — la prod est PostgreSQL)
    const classifier = new MarketClassifier();
    const batchSize = 100;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const markets: Array<{
        condition_id: string;
        question: string | null;
        category: string | null;
        tag_slugs: string;
      }> = await queryRunner.query(
        `SELECT condition_id, question, category, tag_slugs
         FROM markets
         WHERE market_type = 'standard'
         ORDER BY condition_id
         LIMIT $1 OFFSET $2`,
        [batchSize, offset],
      );

      for (const market of markets) {
        const tagSlugs: string[] = JSON.parse(market.tag_slugs || '[]');
        const marketType = classifier.classify({
          question: market.question,
          category: market.category,
          tagSlugs,
        });

        await queryRunner.query(
          `UPDATE markets SET market_type = $1 WHERE condition_id = $2`,
          [marketType, market.condition_id],
        );
      }

      hasMore = markets.length === batchSize;
      offset += batchSize;
    }

    // 3. Rendre la colonne NOT NULL après backfill
    await queryRunner.query(`
      ALTER TABLE markets ALTER COLUMN market_type SET NOT NULL;
    `);

    // 4. Index composé pour les requêtes fréquentes
    //    (Correction §9.10 : index composé market_type + active + closed au lieu d'un index simple)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_markets_type_active_closed
        ON markets (market_type, active, closed);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_markets_type_active_closed;
    `);
    await queryRunner.query(`
      ALTER TABLE markets DROP COLUMN market_type;
    `);
  }
}
