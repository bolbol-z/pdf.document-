-- =============================================================================
--  SCHEMA: referentiel_competences
--  Target : PostgreSQL 14+ / MySQL 8+
--  Author : Senior Data Engineer
--  Notes  : 3NF normalisation of liste_des_competences CSV
--           Multi-value fields (outils, normes, mots_clés) are decomposed
--           into entity + junction tables (avoiding 1NF violations).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. SETUP
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS referentiel;
SET search_path = referentiel;   -- PostgreSQL; remove for MySQL

-- -----------------------------------------------------------------------------
-- 1. DOMAINE
--    Top-level classification (7 rows).
--    Example: "1. CONDUIRE", "2. MANIPULER"
-- -----------------------------------------------------------------------------
CREATE TABLE domaine (
    domaine_id   SERIAL       PRIMARY KEY,
    nom_domaine  VARCHAR(120) NOT NULL UNIQUE
);

-- -----------------------------------------------------------------------------
-- 2. METIER
--    Each métier belongs to exactly one domaine.
--    Example: "Conducteur Routier (PL/SPL)" → domaine "1. CONDUIRE"
-- -----------------------------------------------------------------------------
CREATE TABLE metier (
    metier_id   SERIAL       PRIMARY KEY,
    nom_metier  VARCHAR(150) NOT NULL UNIQUE,
    domaine_id  INT          NOT NULL REFERENCES domaine(domaine_id)
                             ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_metier_domaine ON metier(domaine_id);

-- -----------------------------------------------------------------------------
-- 3. TYPE_COMPETENCE
--    Enum-like lookup: Technique | Organisationnelle | Comportementale | Physique
-- -----------------------------------------------------------------------------
CREATE TABLE type_competence (
    type_competence_id  SERIAL      PRIMARY KEY,
    libelle             VARCHAR(50) NOT NULL UNIQUE
);

-- -----------------------------------------------------------------------------
-- 4. MODALITE_EVALUATION
--    Reusable evaluation methods (79 distinct values, many shared across rows).
--    Extracted to avoid text duplication in competence table.
-- -----------------------------------------------------------------------------
CREATE TABLE modalite_evaluation (
    modalite_id  SERIAL       PRIMARY KEY,
    libelle      VARCHAR(200) NOT NULL UNIQUE
);

-- -----------------------------------------------------------------------------
-- 5. FORMATION_ACTIVITE
--    Pedagogical activity types (40 distinct, high reuse: "TP" used 29×).
-- -----------------------------------------------------------------------------
CREATE TABLE formation_activite (
    formation_id  SERIAL       PRIMARY KEY,
    libelle       VARCHAR(200) NOT NULL UNIQUE
);

-- -----------------------------------------------------------------------------
-- 6. COMPETENCE  (core fact table)
--    One row per competence within a metier.
--    158 rows, each competence is unique (confirmed by analysis).
--
--    Kept as free-text (not further split):
--      - indicateurs_observables    : fully unique per row (158/158 distinct)
--      - preuves_attendues          : 119/158 distinct — borderline but context-rich
--      - situations_professionnelles_type : 157/158 distinct
-- -----------------------------------------------------------------------------
CREATE TABLE competence (
    competence_id               SERIAL        PRIMARY KEY,
    libelle                     TEXT          NOT NULL,
    metier_id                   INT           NOT NULL  REFERENCES metier(metier_id)
                                              ON DELETE RESTRICT ON UPDATE CASCADE,
    type_competence_id          INT           NOT NULL  REFERENCES type_competence(type_competence_id)
                                              ON DELETE RESTRICT ON UPDATE CASCADE,
    indicateurs_observables     TEXT,
    modalite_evaluation_id      INT           REFERENCES modalite_evaluation(modalite_id)
                                              ON DELETE SET NULL ON UPDATE CASCADE,
    preuves_attendues           TEXT,
    situations_professionnelles_type  TEXT,
    formation_activite_id       INT           REFERENCES formation_activite(formation_id)
                                              ON DELETE SET NULL ON UPDATE CASCADE,

    CONSTRAINT uq_competence_metier UNIQUE (libelle, metier_id)
);

CREATE INDEX idx_competence_metier     ON competence(metier_id);
CREATE INDEX idx_competence_type       ON competence(type_competence_id);
CREATE INDEX idx_competence_modalite   ON competence(modalite_evaluation_id);
CREATE INDEX idx_competence_formation  ON competence(formation_activite_id);

-- Full-text search index (PostgreSQL)
CREATE INDEX idx_competence_fts ON competence
    USING GIN(to_tsvector('french', coalesce(libelle,'') || ' ' ||
                                    coalesce(indicateurs_observables,'') || ' ' ||
                                    coalesce(preuves_attendues,'')));

-- -----------------------------------------------------------------------------
-- 7. OUTIL  (tool / SI system / material)
--    Atomic tokens extracted from comma-separated Outils_SI_ou_Materiels.
--    100 distinct tools. Links via junction table.
-- -----------------------------------------------------------------------------
CREATE TABLE outil (
    outil_id  SERIAL       PRIMARY KEY,
    libelle   VARCHAR(150) NOT NULL UNIQUE
);

CREATE TABLE competence_outil (
    competence_id  INT  NOT NULL  REFERENCES competence(competence_id)
                        ON DELETE CASCADE ON UPDATE CASCADE,
    outil_id       INT  NOT NULL  REFERENCES outil(outil_id)
                        ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (competence_id, outil_id)
);
CREATE INDEX idx_comp_outil_outil ON competence_outil(outil_id);

-- -----------------------------------------------------------------------------
-- 8. REGLEMENTATION_NORME
--    Regulatory / normative references — 85 distinct tokens.
-- -----------------------------------------------------------------------------
CREATE TABLE reglementation_norme (
    norme_id  SERIAL       PRIMARY KEY,
    libelle   VARCHAR(200) NOT NULL UNIQUE
);

CREATE TABLE competence_norme (
    competence_id  INT  NOT NULL  REFERENCES competence(competence_id)
                        ON DELETE CASCADE ON UPDATE CASCADE,
    norme_id       INT  NOT NULL  REFERENCES reglementation_norme(norme_id)
                        ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (competence_id, norme_id)
);
CREATE INDEX idx_comp_norme_norme ON competence_norme(norme_id);

-- -----------------------------------------------------------------------------
-- 9. MOT_CLE
--    Keywords — 234 distinct tokens extracted from Mots_Cles.
--    Key table for full-text search and recommendation/matching.
-- -----------------------------------------------------------------------------
CREATE TABLE mot_cle (
    mot_cle_id  SERIAL       PRIMARY KEY,
    libelle     VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE competence_mot_cle (
    competence_id  INT  NOT NULL  REFERENCES competence(competence_id)
                        ON DELETE CASCADE ON UPDATE CASCADE,
    mot_cle_id     INT  NOT NULL  REFERENCES mot_cle(mot_cle_id)
                        ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (competence_id, mot_cle_id)
);
CREATE INDEX idx_comp_kw_kw ON competence_mot_cle(mot_cle_id);

-- =============================================================================
-- USEFUL VIEWS
-- =============================================================================

-- V1: Full denormalized view (mirrors the original CSV structure)
CREATE OR REPLACE VIEW v_competence_full AS
SELECT
    d.nom_domaine,
    m.nom_metier,
    c.libelle                           AS competence,
    tc.libelle                          AS type_competence,
    c.indicateurs_observables,
    me.libelle                          AS modalite_evaluation,
    c.preuves_attendues,
    c.situations_professionnelles_type,
    c.formation_activite_id,
    fa.libelle                          AS formation_activite
FROM competence c
JOIN metier            m   ON c.metier_id             = m.metier_id
JOIN domaine           d   ON m.domaine_id             = d.domaine_id
JOIN type_competence   tc  ON c.type_competence_id     = tc.type_competence_id
LEFT JOIN modalite_evaluation me ON c.modalite_evaluation_id = me.modalite_id
LEFT JOIN formation_activite  fa ON c.formation_activite_id  = fa.formation_id;

-- V2: Competence × keywords (for matching / recommendation engine)
CREATE OR REPLACE VIEW v_competence_keywords AS
SELECT
    c.competence_id,
    c.libelle    AS competence,
    m.nom_metier,
    d.nom_domaine,
    mk.libelle   AS mot_cle
FROM competence_mot_cle cmk
JOIN competence c  ON cmk.competence_id = c.competence_id
JOIN metier     m  ON c.metier_id       = m.metier_id
JOIN domaine    d  ON m.domaine_id      = d.domaine_id
JOIN mot_cle    mk ON cmk.mot_cle_id    = mk.mot_cle_id;

-- V3: Metier profile — aggregated keywords per metier (for job-skill matching)
CREATE OR REPLACE VIEW v_metier_keywords AS
SELECT
    m.metier_id,
    m.nom_metier,
    d.nom_domaine,
    array_agg(DISTINCT mk.libelle ORDER BY mk.libelle) AS mots_cles   -- PostgreSQL; use GROUP_CONCAT for MySQL
FROM competence c
JOIN metier     m   ON c.metier_id     = m.metier_id
JOIN domaine    d   ON m.domaine_id    = d.domaine_id
JOIN competence_mot_cle cmk ON c.competence_id = cmk.competence_id
JOIN mot_cle    mk  ON cmk.mot_cle_id  = mk.mot_cle_id
GROUP BY m.metier_id, m.nom_metier, d.nom_domaine;

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
