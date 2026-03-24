// =============================================================================
//  MONGODB — Référentiel Compétences
//  Target   : MongoDB 6.0+
//  Encoding : UTF-8
//  Collections : 3  (metiers · domaines · vocabulaire)
//  Documents   : 24 metiers · 7 domaines · 542 vocabulaire
//  Author   : Senior NoSQL Architect
// =============================================================================
//
//  DESIGN DECISIONS SUMMARY
//  ─────────────────────────
//  SQL model : 12 tables + 6 junction tables → normalized 3NF
//  NoSQL model: 3 collections → embedding + selective referencing
//
//  COLLECTION        STRATEGY           RATIONALE
//  ─────────────────────────────────────────────────────────────────────
//  metiers           Embed competences  Core query: "get all competences
//                                       of a metier" → single doc fetch
//  domaines          Embed metier refs  Navigation: "list metiers by
//                                       domaine" → no join needed
//  vocabulaire       Single collection  Lookup data (outils, mots_cles,
//                    for all lookups    normes, types) — filtered by
//                                       `categorie` field
//
//  EMBEDDING RATIONALE:
//  - competences are OWNED by a metier (lifecycle dependency)
//  - average doc size: ~4KB per metier → well under 16MB BSON limit
//  - outils/mots_cles embedded as string arrays → $elemMatch, $in queries
//
//  REFERENCING (kept for vocabulaire):
//  - 542 vocabulary items → separate collection avoids duplication
//    when same outil/mot_cle appears in many competences
//  - Trade-off accepted: queries needing vocab metadata do a $lookup
//
// =============================================================================

// =============================================================================
// 0. SETUP — Connect & select database
// =============================================================================

// Connection string:
//   mongodb://localhost:27017
//
// Run from terminal:
//   mongosh "mongodb://localhost:27017/referentiel_competences"
//
// Or connect then select database:
//   mongosh "mongodb://localhost:27017"
//   use referentiel_competences

const conn = new Mongo('mongodb://localhost:27017');
const db   = conn.getDB('referentiel_competences');

use('referentiel_competences');

// =============================================================================
// 1. CREATE COLLECTIONS WITH SCHEMA VALIDATION
// =============================================================================

db.createCollection('metiers', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'metier_id', 'nom_metier', 'domaine', 'competences'],
      properties: {
        metier_id:      { bsonType: 'int',    description: 'SQL FK reference' },
        nom_metier:     { bsonType: 'string', description: 'Unique metier name' },
        domaine:        { bsonType: 'object', description: 'Embedded domaine snapshot' },
        nb_competences: { bsonType: 'int',    description: 'Denormalized count' },
        competences:    { bsonType: 'array',  description: 'Embedded competence documents' },
      }
    }
  },
  validationAction: 'warn'   // warn instead of error for flexibility
});

db.createCollection('domaines', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'domaine_id', 'nom_domaine', 'metiers'],
      properties: {
        domaine_id:  { bsonType: 'int',   description: 'SQL PK reference' },
        nom_domaine: { bsonType: 'string' },
        nb_metiers:  { bsonType: 'int' },
        metiers:     { bsonType: 'array', description: 'Embedded metier references' },
      }
    }
  },
  validationAction: 'warn'
});

db.createCollection('vocabulaire', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'categorie', 'libelle'],
      properties: {
        categorie: {
          bsonType: 'string',
          enum: ['type_competence','modalite_evaluation','formation_activite',
                 'outil','reglementation_norme','mot_cle'],
          description: 'Vocabulary category'
        },
        libelle: { bsonType: 'string' },
        code_id: { bsonType: 'int',    description: 'Original SQL ID' },
      }
    }
  },
  validationAction: 'warn'
});

// =============================================================================
// 2. INDEXES
// =============================================================================

// ── metiers indexes ───────────────────────────────────────────────────────────
db.metiers.createIndex({ 'domaine.domaine_id': 1 },
  { name: 'idx_metier_domaine' });

db.metiers.createIndex({ 'competences.type_competence': 1 },
  { name: 'idx_metier_comp_type' });

db.metiers.createIndex({ 'competences.mots_cles': 1 },
  { name: 'idx_metier_mots_cles' });

db.metiers.createIndex({ 'competences.outils': 1 },
  { name: 'idx_metier_outils' });

db.metiers.createIndex(
  { nom_metier: 'text', 'competences.libelle': 'text',
    'competences.mots_cles': 'text', 'competences.indicateurs_observables': 'text' },
  { name: 'idx_metier_fulltext',
    weights: { nom_metier: 10, 'competences.libelle': 8,
               'competences.mots_cles': 5, 'competences.indicateurs_observables': 2 },
    default_language: 'french' }
);

// ── domaines indexes ──────────────────────────────────────────────────────────
db.domaines.createIndex({ domaine_id: 1 }, { name: 'idx_domaine_id', unique: true });

// ── vocabulaire indexes ────────────────────────────────────────────────────────
db.vocabulaire.createIndex({ categorie: 1, libelle: 1 },
  { name: 'idx_vocab_cat_lib' });

db.vocabulaire.createIndex({ libelle: 'text' },
  { name: 'idx_vocab_fulltext', default_language: 'french' });

// =============================================================================
// 3. DATA — DOMAINES (7 documents)
// =============================================================================

db.domaines.insertMany(
[
  {
    "_id": "domaine_1",
    "domaine_id": 1,
    "nom_domaine": "1. CONDUIRE",
    "nb_metiers": 5,
    "metiers": [
      {
        "metier_id": 1,
        "nom_metier": "Conducteur Routier (PL/SPL)"
      },
      {
        "metier_id": 2,
        "nom_metier": "Conducteur Livreur (VUL)"
      },
      {
        "metier_id": 3,
        "nom_metier": "Ambulancier"
      },
      {
        "metier_id": 4,
        "nom_metier": "Convoyeur de fonds / Dabiste"
      },
      {
        "metier_id": 5,
        "nom_metier": "Batelier - Marinier"
      }
    ]
  },
  {
    "_id": "domaine_2",
    "domaine_id": 2,
    "nom_domaine": "2. MANIPULER",
    "nb_metiers": 4,
    "metiers": [
      {
        "metier_id": 6,
        "nom_metier": "Agent de Quai / Manutentionnaire"
      },
      {
        "metier_id": 7,
        "nom_metier": "Cariste"
      },
      {
        "metier_id": 8,
        "nom_metier": "Préparateur de commandes"
      },
      {
        "metier_id": 9,
        "nom_metier": "Déménageur"
      }
    ]
  },
  {
    "_id": "domaine_3",
    "domaine_id": 3,
    "nom_domaine": "3. RÉPARER & ENTRETENIR",
    "nb_metiers": 2,
    "metiers": [
      {
        "metier_id": 10,
        "nom_metier": "Mécanicien Poids Lourds"
      },
      {
        "metier_id": 11,
        "nom_metier": "Responsable de Parc"
      }
    ]
  },
  {
    "_id": "domaine_4",
    "domaine_id": 4,
    "nom_domaine": "4. PLANIFIER & COORDONNER",
    "nb_metiers": 4,
    "metiers": [
      {
        "metier_id": 12,
        "nom_metier": "Responsable d'Exploitation"
      },
      {
        "metier_id": 13,
        "nom_metier": "Affréteur"
      },
      {
        "metier_id": 14,
        "nom_metier": "Demand Planner (Prévisionniste)"
      },
      {
        "metier_id": 15,
        "nom_metier": "Gestionnaire de Stocks"
      }
    ]
  },
  {
    "_id": "domaine_5",
    "domaine_id": 5,
    "nom_domaine": "5. ANALYSER & CONSEILLER",
    "nb_metiers": 3,
    "metiers": [
      {
        "metier_id": 16,
        "nom_metier": "Responsable Douane"
      },
      {
        "metier_id": 17,
        "nom_metier": "Consultant Logistique / Ingénieur Méthodes"
      },
      {
        "metier_id": 18,
        "nom_metier": "Responsable QSE (Qualité Sécurité)"
      }
    ]
  },
  {
    "_id": "domaine_6",
    "domaine_id": 6,
    "nom_domaine": "6. NÉGOCIER",
    "nb_metiers": 2,
    "metiers": [
      {
        "metier_id": 19,
        "nom_metier": "Commercial Transport"
      },
      {
        "metier_id": 20,
        "nom_metier": "Agent Maritime (Consignataire)"
      }
    ]
  },
  {
    "_id": "domaine_7",
    "domaine_id": 7,
    "nom_domaine": "7. ENCADRER & DIRIGER",
    "nb_metiers": 4,
    "metiers": [
      {
        "metier_id": 21,
        "nom_metier": "Supply Chain Manager"
      },
      {
        "metier_id": 22,
        "nom_metier": "Responsable d'Entrepôt"
      },
      {
        "metier_id": 23,
        "nom_metier": "Responsable d'Agence Transport"
      },
      {
        "metier_id": 24,
        "nom_metier": "Logisticien Humanitaire"
      }
    ]
  }
]
);

// =============================================================================
// 4. DATA — METIERS (24 documents, competences embedded)
// =============================================================================

db.metiers.insertMany(
[
  {
    "_id": "metier_1",
    "metier_id": 1,
    "nom_metier": "Conducteur Routier (PL/SPL)",
    "domaine": {
      "domaine_id": 1,
      "nom_domaine": "1. CONDUIRE"
    },
    "nb_competences": 9,
    "competences": [
      {
        "_id_sql": 1,
        "libelle": "Appliquer les principes de conduite rationnelle pour réduire consommation et risques",
        "type_competence": "Technique",
        "indicateurs_observables": "Anticipation, vitesse adaptée, freinage limité, baisse conso mesurable",
        "modalite_evaluation": "Mise en situation (simulateur/terrain) + grille observation",
        "preuves_attendues": "Grille observation signée + relevés conso/télématique",
        "situations_professionnelles_type": "Trajet avec contraintes délai + conso",
        "formation_activite": "TP simulateur + analyse données",
        "outils": [
          "Télématique",
          "ordinateur de bord"
        ],
        "reglementation_normes": [
          "Sécurité routière"
        ],
        "mots_cles": [
          "consommation",
          "eco-conduite",
          "sécurité"
        ]
      },
      {
        "_id_sql": 2,
        "libelle": "Réaliser des contrôles de base et identifier des anomalies mécaniques simples",
        "type_competence": "Technique",
        "indicateurs_observables": "Check pneus/niveaux/fuites, signalement cohérent, arrêt si danger",
        "modalite_evaluation": "QCM + étude de cas panne + oral",
        "preuves_attendues": "Check-list contrôle + fiche anomalie",
        "situations_professionnelles_type": "Prise de poste et contrôle départ",
        "formation_activite": "TP contrôle départ",
        "outils": [
          "Véhicule",
          "check-list"
        ],
        "reglementation_normes": [
          "Procédures entreprise"
        ],
        "mots_cles": [
          "maintenance 1er niveau",
          "sécurité"
        ]
      },
      {
        "_id_sql": 3,
        "libelle": "Sécuriser le chargement par un arrimage adapté au type de marchandise",
        "type_competence": "Technique",
        "indicateurs_observables": "Sangles/points d’ancrage adaptés, calage, contrôle tension",
        "modalite_evaluation": "Mise en situation atelier + audit",
        "preuves_attendues": "Check-list arrimage + photos",
        "situations_professionnelles_type": "Chargement palettes hétérogènes",
        "formation_activite": "TP arrimage + RETEX",
        "outils": [
          "Sangles",
          "barres",
          "tapis"
        ],
        "reglementation_normes": [
          "Bonnes pratiques arrimage"
        ],
        "mots_cles": [
          "arrimage",
          "chargement"
        ]
      },
      {
        "_id_sql": 4,
        "libelle": "Compléter correctement les documents de transport (CMR/e-CMR) et traçabilité",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Champs complets, cohérence dates/poids/ADR, traçabilité",
        "modalite_evaluation": "Étude de cas + exercice e-CMR",
        "preuves_attendues": "CMR/e-CMR complétée + correction",
        "situations_professionnelles_type": "Enlèvement/livraison multi-clients",
        "formation_activite": "TD documentation transport",
        "outils": [
          "Appli e-CMR",
          "scanner"
        ],
        "reglementation_normes": [
          "Convention CMR"
        ],
        "mots_cles": [
          "CMR",
          "eCMR",
          "traçabilité"
        ]
      },
      {
        "_id_sql": 5,
        "libelle": "Gérer les temps de conduite et repos en conformité RSE",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Planning sans infraction, justification aléas, usage tachy correct",
        "modalite_evaluation": "Étude de cas + QCM réglementaire",
        "preuves_attendues": "Planning + score QCM + relevé tachy simulé",
        "situations_professionnelles_type": "Tournée longue distance",
        "formation_activite": "TD réglementation + simulation tournée",
        "outils": [
          "Chronotachygraphe"
        ],
        "reglementation_normes": [
          "RSE"
        ],
        "mots_cles": [
          "RSE",
          "conformité",
          "tachy"
        ]
      },
      {
        "_id_sql": 6,
        "libelle": "Respecter un itinéraire et adapter la conduite aux contraintes (gabarit, météo, trafic)",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Choix itinéraire justifié, évitement zones interdites, sécurité",
        "modalite_evaluation": "Étude de cas + simulation carto",
        "preuves_attendues": "Itinéraire commenté + justification",
        "situations_professionnelles_type": "Livraison zone urbaine/chantier",
        "formation_activite": "Cas pratiques itinéraires",
        "outils": [
          "GPS pro",
          "carto"
        ],
        "reglementation_normes": [
          "Code route + règles locales"
        ],
        "mots_cles": [
          "gabarit",
          "itinéraire",
          "risque"
        ]
      },
      {
        "_id_sql": 7,
        "libelle": "Adopter une communication professionnelle avec clients/quai/exploitation",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Infos factuelles, ton adapté, gestion conflit, traçabilité échanges",
        "modalite_evaluation": "Jeu de rôle + observation",
        "preuves_attendues": "Compte-rendu appel + grille soft skills",
        "situations_professionnelles_type": "Retard livraison et client mécontent",
        "formation_activite": "Jeux de rôle + débrief",
        "outils": [
          "Téléphone",
          "messagerie"
        ],
        "reglementation_normes": [
          "Charte relation client"
        ],
        "mots_cles": [
          "communication",
          "relation client"
        ]
      },
      {
        "_id_sql": 8,
        "libelle": "Maintenir vigilance et maîtrise de soi en situation de stress routier",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Réactions mesurées, pauses, pas de prise de risque, lucidité",
        "modalite_evaluation": "Entretien structuré + étude de cas",
        "preuves_attendues": "Auto-analyse + plan prévention",
        "situations_professionnelles_type": "Incident route + pression délai",
        "formation_activite": "Atelier facteurs humains",
        "outils": [],
        "reglementation_normes": [
          "Prévention risques routiers"
        ],
        "mots_cles": [
          "stress",
          "sécurité",
          "vigilance"
        ]
      },
      {
        "_id_sql": 9,
        "libelle": "Assurer la capacité à conduire sur longue durée en gérant fatigue et sédentarité",
        "type_competence": "Physique",
        "indicateurs_observables": "Gestion pauses/étirements, hydratation, prévention TMS",
        "modalite_evaluation": "Auto-évaluation guidée + consignes",
        "preuves_attendues": "Plan prévention personnel",
        "situations_professionnelles_type": "Semaine type longue distance",
        "formation_activite": "Module prévention TMS",
        "outils": [],
        "reglementation_normes": [
          "Prévention TMS"
        ],
        "mots_cles": [
          "TMS",
          "fatigue",
          "sédentarité"
        ]
      }
    ]
  },
  {
    "_id": "metier_2",
    "metier_id": 2,
    "nom_metier": "Conducteur Livreur (VUL)",
    "domaine": {
      "domaine_id": 1,
      "nom_domaine": "1. CONDUIRE"
    },
    "nb_competences": 7,
    "competences": [
      {
        "_id_sql": 10,
        "libelle": "Réaliser une conduite urbaine sûre et fluide en respectant contraintes de livraison",
        "type_competence": "Technique",
        "indicateurs_observables": "Zéro incident, respect zones, manœuvres maîtrisées",
        "modalite_evaluation": "Mise en situation + observation",
        "preuves_attendues": "Grille observation",
        "situations_professionnelles_type": "Tournée urbaine dense",
        "formation_activite": "TP conduite urbaine",
        "outils": [
          "VUL"
        ],
        "reglementation_normes": [
          "Code route"
        ],
        "mots_cles": [
          "manœuvres",
          "sécurité",
          "urbain"
        ]
      },
      {
        "_id_sql": 11,
        "libelle": "Utiliser un PDA/scanner pour assurer preuve de livraison et traçabilité",
        "type_competence": "Technique",
        "indicateurs_observables": "Scans corrects, statuts Ã  jour, gestion anomalies",
        "modalite_evaluation": "Exercice outil + cas incident",
        "preuves_attendues": "Logs/exports + captures écran",
        "situations_professionnelles_type": "Livraison avec colis manquants/abîmés",
        "formation_activite": "TP SI logistique",
        "outils": [
          "PDA",
          "scanner"
        ],
        "reglementation_normes": [
          "Procédures traçabilité"
        ],
        "mots_cles": [
          "PDA",
          "POD",
          "scan"
        ]
      },
      {
        "_id_sql": 12,
        "libelle": "Encaisser et gérer les flux de paiement en respectant procédures",
        "type_competence": "Technique",
        "indicateurs_observables": "Encaissements justes, remise conforme, pas d’écart caisse",
        "modalite_evaluation": "Mise en situation + QCM procédure",
        "preuves_attendues": "Bordereau remise + contrôle",
        "situations_professionnelles_type": "Livraison contre remboursement",
        "formation_activite": "Cas pratiques encaissement",
        "outils": [
          "TPE",
          "appli encaissement"
        ],
        "reglementation_normes": [
          "Procédure interne"
        ],
        "mots_cles": [
          "contrôle",
          "encaissement"
        ]
      },
      {
        "_id_sql": 13,
        "libelle": "Charger le véhicule en sécurisant colis et en optimisant l’accessibilité",
        "type_competence": "Technique",
        "indicateurs_observables": "Colis lourds au fond, fragiles protégés, plan de chargement cohérent",
        "modalite_evaluation": "Atelier + audit",
        "preuves_attendues": "Photos chargement + check-list",
        "situations_professionnelles_type": "Préparation tournée 60 stops",
        "formation_activite": "TP chargement",
        "outils": [
          "Chariot",
          "sangles"
        ],
        "reglementation_normes": [
          "Sécurité manutention"
        ],
        "mots_cles": [
          "chargement",
          "ergonomie"
        ]
      },
      {
        "_id_sql": 14,
        "libelle": "Optimiser une tournée (ordre de livraison, fenêtres horaires, priorités)",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Ordre logique, respect créneaux, adaptation aléas",
        "modalite_evaluation": "Étude de cas + optimisation sur carte",
        "preuves_attendues": "Plan tournée + KPI (km/temps/retards)",
        "situations_professionnelles_type": "Tournée avec retours et urgences",
        "formation_activite": "TD optimisation tournée",
        "outils": [
          "Outil tournée",
          "carto"
        ],
        "reglementation_normes": [
          "Contraintes SLA"
        ],
        "mots_cles": [
          "SLA",
          "priorités",
          "routing"
        ]
      },
      {
        "_id_sql": 15,
        "libelle": "Gérer la relation de service client (accueil, explication, réclamation)",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Posture pro, écoute, solution/escale, escalade si besoin",
        "modalite_evaluation": "Jeu de rôle + grille",
        "preuves_attendues": "Grille soft skills + compte-rendu",
        "situations_professionnelles_type": "Client refuse colis",
        "formation_activite": "Jeu de rôle",
        "outils": [],
        "reglementation_normes": [
          "Charte service"
        ],
        "mots_cles": [
          "réclamation",
          "service client"
        ]
      },
      {
        "_id_sql": 16,
        "libelle": "Soutenir l’effort physique répété (montées/descentes, port de colis) en sécurité",
        "type_competence": "Physique",
        "indicateurs_observables": "Gestes sûrs, usage aides, pas de mise en danger",
        "modalite_evaluation": "Observation + module prévention",
        "preuves_attendues": "Check-list gestes/risques",
        "situations_professionnelles_type": "Tournée immeubles sans ascenseur",
        "formation_activite": "TP gestes & postures",
        "outils": [
          "Diable",
          "EPI"
        ],
        "reglementation_normes": [
          "Prévention TMS"
        ],
        "mots_cles": [
          "TMS",
          "port de charges"
        ]
      }
    ]
  },
  {
    "_id": "metier_3",
    "metier_id": 3,
    "nom_metier": "Ambulancier",
    "domaine": {
      "domaine_id": 1,
      "nom_domaine": "1. CONDUIRE"
    },
    "nb_competences": 6,
    "competences": [
      {
        "_id_sql": 17,
        "libelle": "Réaliser les gestes et procédures de premiers secours selon AFGSU",
        "type_competence": "Technique",
        "indicateurs_observables": "Gestes corrects, priorisation, hygiène, transmission",
        "modalite_evaluation": "Simulation haute fidélité + QCM",
        "preuves_attendues": "Fiche simulation + score QCM",
        "situations_professionnelles_type": "Prise en charge détresse",
        "formation_activite": "TP simulation",
        "outils": [
          "Matériel médical"
        ],
        "reglementation_normes": [
          "AFGSU"
        ],
        "mots_cles": [
          "AFGSU",
          "urgence"
        ]
      },
      {
        "_id_sql": 18,
        "libelle": "Conduire de manière souple et sécurisée en situation d’urgence",
        "type_competence": "Technique",
        "indicateurs_observables": "Trajectoires sûres, usage avertisseurs conforme, confort patient",
        "modalite_evaluation": "Simulation conduite + observation",
        "preuves_attendues": "Grille observation",
        "situations_professionnelles_type": "Transport urgent",
        "formation_activite": "TP conduite",
        "outils": [
          "Ambulance"
        ],
        "reglementation_normes": [
          "Code route + règles urgence"
        ],
        "mots_cles": [
          "confort",
          "sécurité",
          "urgence"
        ]
      },
      {
        "_id_sql": 19,
        "libelle": "Préparer et vérifier le matériel médical avant mission",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Check complet, matériel fonctionnel, stocks à jour",
        "modalite_evaluation": "Atelier + audit",
        "preuves_attendues": "Check-list + inventaire",
        "situations_professionnelles_type": "Départ intervention",
        "formation_activite": "TP préparation",
        "outils": [
          "Kit médical"
        ],
        "reglementation_normes": [
          "Procédures hygiène"
        ],
        "mots_cles": [
          "hygiène",
          "préparation"
        ]
      },
      {
        "_id_sql": 20,
        "libelle": "Transmettre des informations pertinentes au SAMU (C15) et à l’équipe",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Transmission structurée, éléments vitaux, traçabilité",
        "modalite_evaluation": "Jeu de rôle + grille",
        "preuves_attendues": "Compte-rendu structuré",
        "situations_professionnelles_type": "Appel C15",
        "formation_activite": "Simulations",
        "outils": [
          "Radio/téléphone"
        ],
        "reglementation_normes": [
          "Protocoles SAMU"
        ],
        "mots_cles": [
          "C15",
          "transmission"
        ]
      },
      {
        "_id_sql": 21,
        "libelle": "Adopter empathie, discrétion et sang-froid avec patients et familles",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Posture calme, respect confidentialité, gestion émotion",
        "modalite_evaluation": "Jeu de rôle + entretien",
        "preuves_attendues": "Grille soft skills",
        "situations_professionnelles_type": "Annonce situation grave",
        "formation_activite": "Jeux de rôle + débrief",
        "outils": [],
        "reglementation_normes": [
          "Secret professionnel"
        ],
        "mots_cles": [
          "discrétion",
          "empathie"
        ]
      },
      {
        "_id_sql": 22,
        "libelle": "Assurer la manutention de patients (brancardage) en sécurité",
        "type_competence": "Physique",
        "indicateurs_observables": "Gestes sûrs, coordination binôme, usage matériel",
        "modalite_evaluation": "Mise en situation",
        "preuves_attendues": "Grille observation",
        "situations_professionnelles_type": "Montée escaliers",
        "formation_activite": "TP brancardage",
        "outils": [
          "Brancard",
          "chaise"
        ],
        "reglementation_normes": [
          "Prévention TMS"
        ],
        "mots_cles": [
          "TMS",
          "brancardage"
        ]
      }
    ]
  },
  {
    "_id": "metier_4",
    "metier_id": 4,
    "nom_metier": "Convoyeur de fonds / Dabiste",
    "domaine": {
      "domaine_id": 1,
      "nom_domaine": "1. CONDUIRE"
    },
    "nb_competences": 6,
    "competences": [
      {
        "_id_sql": 23,
        "libelle": "Appliquer les techniques de conduite sécurisée en véhicule blindé",
        "type_competence": "Technique",
        "indicateurs_observables": "Trajets sécurisés, vigilance, procédures respectées",
        "modalite_evaluation": "Simulation + étude de cas",
        "preuves_attendues": "Grille procédure",
        "situations_professionnelles_type": "Tournée approvisionnement",
        "formation_activite": "Cas sûreté",
        "outils": [
          "Véhicule blindé"
        ],
        "reglementation_normes": [
          "Procédures sûreté"
        ],
        "mots_cles": [
          "convoyage",
          "sûreté"
        ]
      },
      {
        "_id_sql": 24,
        "libelle": "Mettre en œuvre les règles de sécurité et d’usage des équipements (dont armement si applicable)",
        "type_competence": "Technique",
        "indicateurs_observables": "Gestes conformes, respect consignes, aucun écart",
        "modalite_evaluation": "QCM + mise en situation encadrée",
        "preuves_attendues": "Attestation + score QCM",
        "situations_professionnelles_type": "Intervention DAB",
        "formation_activite": "Module sûreté",
        "outils": [
          "Équipements sûreté"
        ],
        "reglementation_normes": [
          "Règles sûreté"
        ],
        "mots_cles": [
          "procédure",
          "sûreté"
        ]
      },
      {
        "_id_sql": 25,
        "libelle": "Réaliser une maintenance de premier niveau sur DAB (diagnostic simple)",
        "type_competence": "Technique",
        "indicateurs_observables": "Diagnostic basique, actions autorisées, escalade claire",
        "modalite_evaluation": "Étude de cas + TP",
        "preuves_attendues": "Fiche intervention",
        "situations_professionnelles_type": "DAB en défaut",
        "formation_activite": "TP maintenance",
        "outils": [
          "Outils de maintenance"
        ],
        "reglementation_normes": [
          "Procédures maintenance"
        ],
        "mots_cles": [
          "DAB",
          "maintenance"
        ]
      },
      {
        "_id_sql": 26,
        "libelle": "Respecter strictement les procédures et gérer l’approvisionnement sans rupture",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Zéro écart procédure, traçabilité, planification",
        "modalite_evaluation": "Étude de cas",
        "preuves_attendues": "Feuille de tournée + traçabilité",
        "situations_professionnelles_type": "Tournée multi-sites",
        "formation_activite": "TD",
        "outils": [
          "Logiciel tournée"
        ],
        "reglementation_normes": [
          "Procédures internes"
        ],
        "mots_cles": [
          "procédure",
          "traçabilité"
        ]
      },
      {
        "_id_sql": 27,
        "libelle": "Faire preuve d’intégrité, discrétion et vigilance en permanence",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Pas de divulgation, attitude conforme, alertes pertinentes",
        "modalite_evaluation": "Entretien + mises en situation",
        "preuves_attendues": "Grille éthique",
        "situations_professionnelles_type": "Pression externe",
        "formation_activite": "Cas éthiques",
        "outils": [],
        "reglementation_normes": [
          "Déontologie"
        ],
        "mots_cles": [
          "discrétion",
          "intégrité"
        ]
      },
      {
        "_id_sql": 28,
        "libelle": "Soutenir l et le stress (port, posture, charge mentale)",
        "type_competence": "Physique",
        "indicateurs_observables": "Stabilité émotionnelle, gestes sûrs, endurance",
        "modalite_evaluation": "Observation + entretien",
        "preuves_attendues": "Plan prévention",
        "situations_professionnelles_type": "Tournée longue + incidents",
        "formation_activite": "Atelier facteurs humains",
        "outils": [
          "EPI"
        ],
        "reglementation_normes": [
          "Prévention risques"
        ],
        "mots_cles": [
          "endurance",
          "stress"
        ]
      }
    ]
  },
  {
    "_id": "metier_5",
    "metier_id": 5,
    "nom_metier": "Batelier - Marinier",
    "domaine": {
      "domaine_id": 1,
      "nom_domaine": "1. CONDUIRE"
    },
    "nb_competences": 5,
    "competences": [
      {
        "_id_sql": 29,
        "libelle": "Piloter un bateau fluvial en conditions standard en intégrant règles de navigation",
        "type_competence": "Technique",
        "indicateurs_observables": "Tenue de route, manÅuvres, respect signaux",
        "modalite_evaluation": "Simulation/étude de cas",
        "preuves_attendues": "Journal de navigation simulé",
        "situations_professionnelles_type": "Passage écluse",
        "formation_activite": "TP",
        "outils": [
          "Bateau/Simu"
        ],
        "reglementation_normes": [
          "Règlement navigation"
        ],
        "mots_cles": [
          "navigation fluviale"
        ]
      },
      {
        "_id_sql": 30,
        "libelle": "Diagnostiquer des pannes simples et réaliser des actions de mécanique navale de base",
        "type_competence": "Technique",
        "indicateurs_observables": "Détection anomalies, actions autorisées, sécurité",
        "modalite_evaluation": "Étude de cas + TP",
        "preuves_attendues": "Fiche maintenance",
        "situations_professionnelles_type": "Panne pompe",
        "formation_activite": "TP",
        "outils": [
          "Outils",
          "moteur"
        ],
        "reglementation_normes": [
          "Procédures maintenance"
        ],
        "mots_cles": [
          "maintenance navale"
        ]
      },
      {
        "_id_sql": 31,
        "libelle": "Planifier un trajet fluvial (temps, écluses, contraintes) et la vie à bord",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Plan réaliste, marges, organisation quart",
        "modalite_evaluation": "Étude de cas",
        "preuves_attendues": "Plan de voyage",
        "situations_professionnelles_type": "Trajet multi-écluses",
        "formation_activite": "TD",
        "outils": [
          "Cartes",
          "planning"
        ],
        "reglementation_normes": [
          "Règles navigation"
        ],
        "mots_cles": [
          "autonomie",
          "planification"
        ]
      },
      {
        "_id_sql": 32,
        "libelle": "Travailler en autonomie avec calme et gestion d restreint",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Décisions posées, organisation, communication",
        "modalite_evaluation": "Entretien + observation",
        "preuves_attendues": "Journal de bord",
        "situations_professionnelles_type": "Mission longue",
        "formation_activite": "Atelier",
        "outils": [],
        "reglementation_normes": [
          "Prévention risques"
        ],
        "mots_cles": [
          "autonomie",
          "calme"
        ]
      },
      {
        "_id_sql": 33,
        "libelle": "Maintenir aptitude sensorielle et endurance en environnement confiné",
        "type_competence": "Physique",
        "indicateurs_observables": "Vigilance, gestion fatigue, respect repos",
        "modalite_evaluation": "Auto-évaluation + consignes",
        "preuves_attendues": "Plan prévention",
        "situations_professionnelles_type": "Vie à bord prolongée",
        "formation_activite": "Module",
        "outils": [],
        "reglementation_normes": [
          "Prévention fatigue"
        ],
        "mots_cles": [
          "fatigue",
          "vigilance"
        ]
      }
    ]
  },
  {
    "_id": "metier_6",
    "metier_id": 6,
    "nom_metier": "Agent de Quai / Manutentionnaire",
    "domaine": {
      "domaine_id": 2,
      "nom_domaine": "2. MANIPULER"
    },
    "nb_competences": 7,
    "competences": [
      {
        "_id_sql": 34,
        "libelle": "Réaliser filmage, palettisation et manutention avec qualité et sécurité",
        "type_competence": "Technique",
        "indicateurs_observables": "Palette stable, filmage uniforme, absence casse",
        "modalite_evaluation": "Mise en situation + audit",
        "preuves_attendues": "Photos + check-list qualité",
        "situations_professionnelles_type": "Préparation expédition",
        "formation_activite": "TP",
        "outils": [
          "Filmeuse",
          "transpalette"
        ],
        "reglementation_normes": [
          "Sécurité EPI"
        ],
        "mots_cles": [
          "filmage",
          "palettisation"
        ]
      },
      {
        "_id_sql": 35,
        "libelle": "Utiliser un transpalette manuel/électrique en respectant sécurité et flux",
        "type_competence": "Technique",
        "indicateurs_observables": "Conduite sûre, respect zones, pas de heurt",
        "modalite_evaluation": "Mise en situation",
        "preuves_attendues": "Grille observation",
        "situations_professionnelles_type": "Chargement quai",
        "formation_activite": "TP",
        "outils": [
          "Transpalette"
        ],
        "reglementation_normes": [
          "Règles quai"
        ],
        "mots_cles": [
          "sécurité",
          "transpalette"
        ]
      },
      {
        "_id_sql": 36,
        "libelle": "Lire et exploiter les étiquettes et documents de tri (codes, destinations)",
        "type_competence": "Technique",
        "indicateurs_observables": "Zéro erreur de tri, cohérence scan/étiquette",
        "modalite_evaluation": "Exercice tri + QCM",
        "preuves_attendues": "Résultats tri + score",
        "situations_professionnelles_type": "Cross-docking",
        "formation_activite": "TP",
        "outils": [
          "Scanner"
        ],
        "reglementation_normes": [
          "Procédures traçabilité"
        ],
        "mots_cles": [
          "tri",
          "étiquetage"
        ]
      },
      {
        "_id_sql": 37,
        "libelle": "Trier les flux en cross-docking en respectant priorités et délais",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Temps de passage réduit, respect priorités, pas d’erreur quai",
        "modalite_evaluation": "Simulation flux",
        "preuves_attendues": "KPI temps + erreurs",
        "situations_professionnelles_type": "Rush quai",
        "formation_activite": "Serious game",
        "outils": [
          "WMS/tri"
        ],
        "reglementation_normes": [
          "SLA"
        ],
        "mots_cles": [
          "cross-docking",
          "délai"
        ]
      },
      {
        "_id_sql": 38,
        "libelle": "Appliquer les règles de sécurité (EPI, circulation, posture) et maintenir un quai rangé",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Port EPI, zones dégagées, rangement conforme",
        "modalite_evaluation": "Audit sécurité",
        "preuves_attendues": "Check-list audit",
        "situations_professionnelles_type": "Fin de poste",
        "formation_activite": "Visite sécurité",
        "outils": [
          "EPI"
        ],
        "reglementation_normes": [
          "Règles sécurité site"
        ],
        "mots_cles": [
          "5S",
          "sécurité"
        ]
      },
      {
        "_id_sql": 39,
        "libelle": "Collaborer en équipe et communiquer efficacement en environnement cadencé",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Aide spontanée, consignes claires, pas de conflit",
        "modalite_evaluation": "Observation + jeu de rôle",
        "preuves_attendues": "Grille soft skills",
        "situations_professionnelles_type": "Pic d’activité",
        "formation_activite": "Exercice",
        "outils": [
          "Talkie-walkie"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "communication",
          "équipe"
        ]
      },
      {
        "_id_sql": 40,
        "libelle": "Soutenir effort physique (debout, port de charges, gestes répétitifs) en limitant risques",
        "type_competence": "Physique",
        "indicateurs_observables": "Gestes sûrs, pauses, usage aides",
        "modalite_evaluation": "Observation",
        "preuves_attendues": "Grille gestes",
        "situations_professionnelles_type": "Poste quai",
        "formation_activite": "TP",
        "outils": [
          "Aides manutention"
        ],
        "reglementation_normes": [
          "Prévention TMS"
        ],
        "mots_cles": [
          "TMS",
          "port de charges"
        ]
      }
    ]
  },
  {
    "_id": "metier_7",
    "metier_id": 7,
    "nom_metier": "Cariste",
    "domaine": {
      "domaine_id": 2,
      "nom_domaine": "2. MANIPULER"
    },
    "nb_competences": 7,
    "competences": [
      {
        "_id_sql": 41,
        "libelle": "Conduire un chariot (CACES 1/3/5) selon consignes et environnement",
        "type_competence": "Technique",
        "indicateurs_observables": "Contrôles pré-op, manœuvres sûres, respect plan circulation",
        "modalite_evaluation": "Mise en situation + observation",
        "preuves_attendues": "Grille observation",
        "situations_professionnelles_type": "Réception/stockage",
        "formation_activite": "TP",
        "outils": [
          "Chariot",
          "EPI"
        ],
        "reglementation_normes": [
          "Règles sécurité"
        ],
        "mots_cles": [
          "CACES",
          "conduite"
        ]
      },
      {
        "_id_sql": 42,
        "libelle": "Réaliser un gerbage grande hauteur en sécurité et avec précision",
        "type_competence": "Technique",
        "indicateurs_observables": "Palette stable, hauteur maîtrisée, zéro choc rack",
        "modalite_evaluation": "Mise en situation",
        "preuves_attendues": "Grille observation",
        "situations_professionnelles_type": "Stockage",
        "formation_activite": "TP",
        "outils": [
          "Chariot m"
        ],
        "reglementation_normes": [
          "Sécurité entrepôt"
        ],
        "mots_cles": [
          "gerbage",
          "hauteur"
        ]
      },
      {
        "_id_sql": 43,
        "libelle": "Utiliser un WMS embarqué (scan, missions, anomalies) pour assurer traçabilité",
        "type_competence": "Technique",
        "indicateurs_observables": "Missions validées, anomalies traitées, stocks fiables",
        "modalite_evaluation": "Exercice WMS + cas",
        "preuves_attendues": "Exports WMS + captures",
        "situations_professionnelles_type": "Réassort",
        "formation_activite": "TP SI",
        "outils": [
          "PDA",
          "WMS"
        ],
        "reglementation_normes": [
          "Traçabilité"
        ],
        "mots_cles": [
          "WMS",
          "traçabilité"
        ]
      },
      {
        "_id_sql": 44,
        "libelle": "Optimiser le stockage (adressage, densité, rotation) selon règles FIFO/ABC",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Choix emplacement justifié, réduction déplacements, respect rotation",
        "modalite_evaluation": "Étude de cas + optimisation",
        "preuves_attendues": "Plan d + KPI",
        "situations_professionnelles_type": "Réorganisation zone",
        "formation_activite": "Projet",
        "outils": [
          "WMS/Excel"
        ],
        "reglementation_normes": [
          "FIFO/ABC"
        ],
        "mots_cles": [
          "ABC",
          "FIFO",
          "implantation"
        ]
      },
      {
        "_id_sql": 45,
        "libelle": "Effectuer une maintenance de premier niveau (batterie, état fourches, signalement)",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Entretien réalisé, anomalies signalées, arrêt si danger",
        "modalite_evaluation": "Audit + QCM",
        "preuves_attendues": "Fiche maintenance",
        "situations_professionnelles_type": "Début/fin poste",
        "formation_activite": "TP",
        "outils": [
          "Chariot"
        ],
        "reglementation_normes": [
          "Procédures sécurité"
        ],
        "mots_cles": [
          "maintenance N1"
        ]
      },
      {
        "_id_sql": 46,
        "libelle": "Faire preuve de prudence, concentration et précision dans un environnement à risque",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Pas de prise de risque, attention constante, gestes maîtrisés",
        "modalite_evaluation": "Observation",
        "preuves_attendues": "Grille soft skills",
        "situations_professionnelles_type": "Pic d’activité",
        "formation_activite": "Atelier",
        "outils": [],
        "reglementation_normes": [
          "Culture sécurité"
        ],
        "mots_cles": [
          "concentration",
          "prudence"
        ]
      },
      {
        "_id_sql": 47,
        "libelle": "Maintenir aptitude physique (vision relief, résistance vibrations, torsion) et prévenir TMS",
        "type_competence": "Physique",
        "indicateurs_observables": "Postures adaptées, pauses, réglages poste",
        "modalite_evaluation": "Auto-évaluation + observation",
        "preuves_attendues": "Plan prévention",
        "situations_professionnelles_type": "Poste chariot",
        "formation_activite": "TP",
        "outils": [
          "EPI"
        ],
        "reglementation_normes": [
          "Prévention TMS"
        ],
        "mots_cles": [
          "TMS",
          "ergonomie"
        ]
      }
    ]
  },
  {
    "_id": "metier_8",
    "metier_id": 8,
    "nom_metier": "Préparateur de commandes",
    "domaine": {
      "domaine_id": 2,
      "nom_domaine": "2. MANIPULER"
    },
    "nb_competences": 7,
    "competences": [
      {
        "_id_sql": 48,
        "libelle": "Utiliser la commande vocale (voice picking) et appliquer les instructions",
        "type_competence": "Technique",
        "indicateurs_observables": "Taux d faible, confirmations correctes, rythme stable",
        "modalite_evaluation": "Mise en situation",
        "preuves_attendues": "KPI erreurs + temps",
        "situations_professionnelles_type": "Prépa multi-lignes",
        "formation_activite": "TP",
        "outils": [
          "Casque voice"
        ],
        "reglementation_normes": [
          "Procédures WMS"
        ],
        "mots_cles": [
          "voice picking"
        ]
      },
      {
        "_id_sql": 49,
        "libelle": "Emballer et protéger les produits selon contraintes (fragile, température, volume)",
        "type_competence": "Technique",
        "indicateurs_observables": "Emballage adapté, pas de casse, conformité",
        "modalite_evaluation": "Atelier + audit",
        "preuves_attendues": "Photos + contrôle",
        "situations_professionnelles_type": "Prépa e-commerce",
        "formation_activite": "TP",
        "outils": [
          "Matériel emballage"
        ],
        "reglementation_normes": [
          "Qualité"
        ],
        "mots_cles": [
          "packing",
          "qualité"
        ]
      },
      {
        "_id_sql": 50,
        "libelle": "Constituer des palettes stables et conformes aux règles de chargement",
        "type_competence": "Technique",
        "indicateurs_observables": "Stabilité, répartition masses, filmage",
        "modalite_evaluation": "Mise en situation",
        "preuves_attendues": "Check-list",
        "situations_professionnelles_type": "Expédition palettes",
        "formation_activite": "TP",
        "outils": [
          "Filmeuse"
        ],
        "reglementation_normes": [
          "Sécurité"
        ],
        "mots_cles": [
          "palettisation"
        ]
      },
      {
        "_id_sql": 51,
        "libelle": "Respecter les cadences et organiser son circuit de chasse",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Parcours optimisé, temps conforme, pas d’oubli",
        "modalite_evaluation": "Simulation + chrono",
        "preuves_attendues": "KPI productivité",
        "situations_professionnelles_type": "Prépa vague",
        "formation_activite": "Serious game",
        "outils": [
          "WMS"
        ],
        "reglementation_normes": [
          "SLA"
        ],
        "mots_cles": [
          "cadence",
          "picking"
        ]
      },
      {
        "_id_sql": 52,
        "libelle": "Assurer une qualité “zéro erreur” par auto-contrôle et traitement anomalies",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Taux erreur faible, anomalies escaladées, traçabilité",
        "modalite_evaluation": "Audit + cas",
        "preuves_attendues": "Rapport anomalies",
        "situations_professionnelles_type": "Rupture stock",
        "formation_activite": "TP",
        "outils": [
          "WMS"
        ],
        "reglementation_normes": [
          "Procédures qualité"
        ],
        "mots_cles": [
          "qualité",
          "zéro défaut"
        ]
      },
      {
        "_id_sql": 53,
        "libelle": "Adopter dynamisme, rigueur et honnêteté (intégrité stock)",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Respect règles, pas d’écarts, posture pro",
        "modalite_evaluation": "Entretien + cas",
        "preuves_attendues": "Grille soft skills",
        "situations_professionnelles_type": "Tentations/écarts",
        "formation_activite": "Cas",
        "outils": [],
        "reglementation_normes": [
          "Éthique"
        ],
        "mots_cles": [
          "intégrité",
          "rigueur"
        ]
      },
      {
        "_id_sql": 54,
        "libelle": "Soutenir marche intensive et port de charges en sécurité",
        "type_competence": "Physique",
        "indicateurs_observables": "Gestes sûrs, usage aides, gestion fatigue",
        "modalite_evaluation": "Observation",
        "preuves_attendues": "Grille gestes",
        "situations_professionnelles_type": "Prépa journée complète",
        "formation_activite": "TP",
        "outils": [
          "Chaussures",
          "EPI"
        ],
        "reglementation_normes": [
          "Prévention TMS"
        ],
        "mots_cles": [
          "marche",
          "port de charges"
        ]
      }
    ]
  },
  {
    "_id": "metier_9",
    "metier_id": 9,
    "nom_metier": "Déménageur",
    "domaine": {
      "domaine_id": 2,
      "nom_domaine": "2. MANIPULER"
    },
    "nb_competences": 6,
    "competences": [
      {
        "_id_sql": 55,
        "libelle": "Emballer le mobilier et protéger les objets selon fragilité et valeur",
        "type_competence": "Technique",
        "indicateurs_observables": "Protection adaptée, zéro casse, étiquetage",
        "modalite_evaluation": "Atelier",
        "preuves_attendues": "Photos + check-list",
        "situations_professionnelles_type": "Déménagement appartement",
        "formation_activite": "TP",
        "outils": [
          "Cartons",
          "couvertures"
        ],
        "reglementation_normes": [
          "Qualité"
        ],
        "mots_cles": [
          "emballage",
          "fragile"
        ]
      },
      {
        "_id_sql": 56,
        "libelle": "Monter/démonter des meubles en respectant méthodes et outillage",
        "type_competence": "Technique",
        "indicateurs_observables": "Assemblage correct, pas de perte pièces, sécurité",
        "modalite_evaluation": "Mise en situation",
        "preuves_attendues": "Check-list",
        "situations_professionnelles_type": "Démontage lit/armoire",
        "formation_activite": "TP",
        "outils": [
          "Outillage"
        ],
        "reglementation_normes": [
          "Sécurité"
        ],
        "mots_cles": [
          "montage",
          "outillage"
        ]
      },
      {
        "_id_sql": 57,
        "libelle": "Charger un camion en optimisant volumes, stabilité et accessibilité",
        "type_competence": "Technique",
        "indicateurs_observables": "Répartition masses, calage, optimisation espace",
        "modalite_evaluation": "Atelier + audit",
        "preuves_attendues": "Photos chargement",
        "situations_professionnelles_type": "Camion complet",
        "formation_activite": "TP",
        "outils": [
          "Sangles",
          "cales"
        ],
        "reglementation_normes": [
          "Sécurité"
        ],
        "mots_cles": [
          "calage",
          "chargement"
        ]
      },
      {
        "_id_sql": 58,
        "libelle": "Coordonner une équipe et gérer le temps chez le client",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Brief clair, séquencement t respect délai",
        "modalite_evaluation": "Jeu de rôle + observation",
        "preuves_attendues": "Plan d",
        "situations_professionnelles_type": "Déménagement avec contraintes",
        "formation_activite": "Exercice",
        "outils": [],
        "reglementation_normes": [],
        "mots_cles": [
          "coordination",
          "timing"
        ]
      },
      {
        "_id_sql": 59,
        "libelle": "Adopter politesse, discrétion et soin des biens chez le client",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Respect domicile, communication, attention",
        "modalite_evaluation": "Jeu de rôle",
        "preuves_attendues": "Grille soft skills",
        "situations_professionnelles_type": "Client exigeant",
        "formation_activite": "Jeu de rôle",
        "outils": [],
        "reglementation_normes": [
          "Charte service"
        ],
        "mots_cles": [
          "client",
          "discrétion",
          "soin"
        ]
      },
      {
        "_id_sql": 60,
        "libelle": "Assumer efforts lourds et gestes répétitifs en sécurité (prévention blessures)",
        "type_competence": "Physique",
        "indicateurs_observables": "Gestes sûrs, usage sangles, pas de surcharge",
        "modalite_evaluation": "Observation",
        "preuves_attendues": "Grille gestes",
        "situations_professionnelles_type": "Port piano/charges",
        "formation_activite": "TP",
        "outils": [
          "Sangles",
          "diable"
        ],
        "reglementation_normes": [
          "Prévention TMS"
        ],
        "mots_cles": [
          "endurance",
          "force"
        ]
      }
    ]
  },
  {
    "_id": "metier_10",
    "metier_id": 10,
    "nom_metier": "Mécanicien Poids Lourds",
    "domaine": {
      "domaine_id": 3,
      "nom_domaine": "3. RÉPARER & ENTRETENIR"
    },
    "nb_competences": 7,
    "competences": [
      {
        "_id_sql": 61,
        "libelle": "Réaliser un diagnostic électronique à l’aide d’une valise et interpréter codes défaut",
        "type_competence": "Technique",
        "indicateurs_observables": "Diagnostic cohérent, hypothèses, tests confirmatoires",
        "modalite_evaluation": "TP atelier + étude de cas",
        "preuves_attendues": "Rapport diagnostic",
        "situations_professionnelles_type": "Panne freinage ABS",
        "formation_activite": "TP",
        "outils": [
          "Valise diag"
        ],
        "reglementation_normes": [
          "Procédures atelier"
        ],
        "mots_cles": [
          "diagnostic",
          "électronique"
        ]
      },
      {
        "_id_sql": 62,
        "libelle": "Intervenir sur systèmes hydraulique/pneumatique en respectant sécurité",
        "type_competence": "Technique",
        "indicateurs_observables": "Intervention correcte, purge, contrôle étanchéité",
        "modalite_evaluation": "TP",
        "preuves_attendues": "Fiche intervention",
        "situations_professionnelles_type": "Panne air",
        "formation_activite": "TP",
        "outils": [
          "Outillage"
        ],
        "reglementation_normes": [
          "Consignes sécurité"
        ],
        "mots_cles": [
          "hydraulique",
          "pneumatique"
        ]
      },
      {
        "_id_sql": 63,
        "libelle": "Réaliser opérations de maintenance sur moteur/freins selon plan",
        "type_competence": "Technique",
        "indicateurs_observables": "Procédure respectée, couple serrage, essai",
        "modalite_evaluation": "TP",
        "preuves_attendues": "Ordre de réparation",
        "situations_professionnelles_type": "Révision",
        "formation_activite": "TP",
        "outils": [
          "Outillage"
        ],
        "reglementation_normes": [
          "Normes constructeur"
        ],
        "mots_cles": [
          "freins",
          "maintenance"
        ]
      },
      {
        "_id_sql": 64,
        "libelle": "Planifier les entretiens et organiser les interventions en atelier",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Planning réaliste, priorités, disponibilité",
        "modalite_evaluation": "Étude de cas",
        "preuves_attendues": "Planning atelier",
        "situations_professionnelles_type": "Flotte 20 PL",
        "formation_activite": "Projet",
        "outils": [
          "GMAO"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "GMAO",
          "planification"
        ]
      },
      {
        "_id_sql": 65,
        "libelle": "Gérer les pièces détachées (commande, stock, traçabilité)",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Disponibilité pièces, stock fiable, traçabilité",
        "modalite_evaluation": "Cas + exercice",
        "preuves_attendues": "Bon de commande + inventaire",
        "situations_professionnelles_type": "Rupture pièce critique",
        "formation_activite": "TD",
        "outils": [
          "ERP/GMAO"
        ],
        "reglementation_normes": [
          "Procédures achats"
        ],
        "mots_cles": [
          "pièces",
          "stock"
        ]
      },
      {
        "_id_sql": 66,
        "libelle": "Faire preuve d’habileté, autonomie et raisonnement logique en dépannage",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Hypothèses structurées, autonomie, sécurité",
        "modalite_evaluation": "Entretien + cas",
        "preuves_attendues": "Arbre de diagnostic",
        "situations_professionnelles_type": "Panne intermittente",
        "formation_activite": "Atelier",
        "outils": [],
        "reglementation_normes": [
          "Culture sécurité"
        ],
        "mots_cles": [
          "autonomie",
          "raisonnement"
        ]
      },
      {
        "_id_sql": 67,
        "libelle": "Travailler en conditions physiques contraignantes en sécurité (bruit, postures)",
        "type_competence": "Physique",
        "indicateurs_observables": "EPI, postures, pauses, respect consignes",
        "modalite_evaluation": "Observation",
        "preuves_attendues": "Audit EPI",
        "situations_professionnelles_type": "Atelier",
        "formation_activite": "Module",
        "outils": [
          "EPI"
        ],
        "reglementation_normes": [
          "Sécurité au travail"
        ],
        "mots_cles": [
          "bruit",
          "postures"
        ]
      }
    ]
  },
  {
    "_id": "metier_11",
    "metier_id": 11,
    "nom_metier": "Responsable de Parc",
    "domaine": {
      "domaine_id": 3,
      "nom_domaine": "3. RÉPARER & ENTRETENIR"
    },
    "nb_competences": 7,
    "competences": [
      {
        "_id_sql": 68,
        "libelle": "Gérer une flotte de véhicules (affectation, disponibilité, suivi)",
        "type_competence": "Technique",
        "indicateurs_observables": "Taux dispo, suivi kilométrage, reporting",
        "modalite_evaluation": "Étude de cas + projet",
        "preuves_attendues": "Tableau de bord flotte",
        "situations_professionnelles_type": "Flotte multi-sites",
        "formation_activite": "Projet",
        "outils": [
          "Outil flotte/Excel"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "disponibilité",
          "fleet"
        ]
      },
      {
        "_id_sql": 69,
        "libelle": "Assurer le suivi des contrôles techniques et conformité réglementaire",
        "type_competence": "Technique",
        "indicateurs_observables": "Échéances respectées, aucun véhicule non conforme",
        "modalite_evaluation": "Audit + cas",
        "preuves_attendues": "Planning échéances",
        "situations_professionnelles_type": "Contrôle technique à venir",
        "formation_activite": "TD",
        "outils": [
          "Outil flotte"
        ],
        "reglementation_normes": [
          "Réglementations"
        ],
        "mots_cles": [
          "CT",
          "conformité"
        ]
      },
      {
        "_id_sql": 70,
        "libelle": "Négocier des contrats de maintenance et piloter prestataires",
        "type_competence": "Technique",
        "indicateurs_observables": "Comparatif offres, clauses, suivi qualité",
        "modalite_evaluation": "Étude de cas + négociation",
        "preuves_attendues": "Analyse offres + CR",
        "situations_professionnelles_type": "Renouvellement contrat",
        "formation_activite": "Jeu de rôle",
        "outils": [],
        "reglementation_normes": [
          "Droit commercial (bases)"
        ],
        "mots_cles": [
          "contrat",
          "négociation"
        ]
      },
      {
        "_id_sql": 71,
        "libelle": "Suivre les coûts d’entretien (TCO) et proposer optimisations",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Calcul TCO, analyse dérives, actions",
        "modalite_evaluation": "Projet Excel/BI",
        "preuves_attendues": "Dashboard coûts",
        "situations_professionnelles_type": "Budget annuel",
        "formation_activite": "Projet",
        "outils": [
          "Excel/BI"
        ],
        "reglementation_normes": [
          "Gestion budgétaire"
        ],
        "mots_cles": [
          "TCO",
          "coûts"
        ]
      },
      {
        "_id_sql": 72,
        "libelle": "Planifier disponibilité véhicules en lien exploitation",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Plan réaliste, arbitrages, communication",
        "modalite_evaluation": "Étude de cas",
        "preuves_attendues": "Planning",
        "situations_professionnelles_type": "Pic saisonnier",
        "formation_activite": "TD",
        "outils": [],
        "reglementation_normes": [],
        "mots_cles": [
          "coordination",
          "planning"
        ]
      },
      {
        "_id_sql": 73,
        "libelle": "Faire preuve de rigueur administrative et sens de la négociation",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Dossiers complets, négociation argumentée",
        "modalite_evaluation": "Entretien + cas",
        "preuves_attendues": "Dossier complet",
        "situations_professionnelles_type": "Litige facture",
        "formation_activite": "Exercice",
        "outils": [],
        "reglementation_normes": [],
        "mots_cles": [
          "négociation",
          "rigueur"
        ]
      },
      {
        "_id_sql": 74,
        "libelle": "Assurer présence terrain et déplacements sur parc en sécurité",
        "type_competence": "Physique",
        "indicateurs_observables": "Respect circulation parc, EPI",
        "modalite_evaluation": "Observation",
        "preuves_attendues": "Audit sécurité",
        "situations_professionnelles_type": "Visite parc",
        "formation_activite": "Visite sécurité",
        "outils": [
          "EPI"
        ],
        "reglementation_normes": [
          "Sécurité site"
        ],
        "mots_cles": [
          "EPI",
          "terrain"
        ]
      }
    ]
  },
  {
    "_id": "metier_12",
    "metier_id": 12,
    "nom_metier": "Responsable d'Exploitation",
    "domaine": {
      "domaine_id": 4,
      "nom_domaine": "4. PLANIFIER & COORDONNER"
    },
    "nb_competences": 7,
    "competences": [
      {
        "_id_sql": 75,
        "libelle": "Appliquer la réglementation transport (RSE) dans l’organisation des tournées",
        "type_competence": "Technique",
        "indicateurs_observables": "Plans conformes, contrôles infractions, actions correctives",
        "modalite_evaluation": "Étude de cas + QCM",
        "preuves_attendues": "Planning + score",
        "situations_professionnelles_type": "Gestion tournée",
        "formation_activite": "TD",
        "outils": [
          "TMS"
        ],
        "reglementation_normes": [
          "RSE"
        ],
        "mots_cles": [
          "RSE",
          "exploitation"
        ]
      },
      {
        "_id_sql": 76,
        "libelle": "Exploiter un TMS/SAEIV pour planifier, suivre et tracer les opérations",
        "type_competence": "Technique",
        "indicateurs_observables": "Plans optimisés, suivi temps réel, traçabilité",
        "modalite_evaluation": "TP outil + cas",
        "preuves_attendues": "Exports TMS + captures",
        "situations_professionnelles_type": "Aléas livraison",
        "formation_activite": "TP SI",
        "outils": [
          "TMS/SAEIV"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "TMS",
          "tracking"
        ]
      },
      {
        "_id_sql": 77,
        "libelle": "Calculer la rentabilité d’une tournée/dossier et proposer arbitrages",
        "type_competence": "Technique",
        "indicateurs_observables": "Marge calculée, hypothèses, recommandations",
        "modalite_evaluation": "Étude de cas chiffrée",
        "preuves_attendues": "Tableau marge",
        "situations_professionnelles_type": "Dossier Ã  faible marge",
        "formation_activite": "TD",
        "outils": [
          "Excel"
        ],
        "reglementation_normes": [
          "Contrôle de gestion (bases)"
        ],
        "mots_cles": [
          "marge",
          "rentabilité"
        ]
      },
      {
        "_id_sql": 78,
        "libelle": "Gérer les aléas en temps réel (panne, retard, client) et replanifier",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Décisions rapides, impacts évalués, communication",
        "modalite_evaluation": "Simulation crise",
        "preuves_attendues": "CR décisions",
        "situations_professionnelles_type": "Accident + urgence",
        "formation_activite": "Serious game",
        "outils": [
          "TMS",
          "téléphone"
        ],
        "reglementation_normes": [
          "Procédures"
        ],
        "mots_cles": [
          "aléas",
          "replanif"
        ]
      },
      {
        "_id_sql": 79,
        "libelle": "Manager les conducteurs (brief, suivi, règles, performance)",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Brief clair, feedback, suivi KPI",
        "modalite_evaluation": "Jeu de rôle + cas",
        "preuves_attendues": "Plan d",
        "situations_professionnelles_type": "Équipe 30 conducteurs",
        "formation_activite": "Jeu de rôle",
        "outils": [
          "KPI"
        ],
        "reglementation_normes": [
          "Droit du travail (bases)"
        ],
        "mots_cles": [
          "briefing",
          "management"
        ]
      },
      {
        "_id_sql": 80,
        "libelle": "Faire preuve de leadership et résistance au stress dans la décision",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Décisions assumées, calme, écoute",
        "modalite_evaluation": "Entretien + simulation",
        "preuves_attendues": "Grille soft skills",
        "situations_professionnelles_type": "Crise service",
        "formation_activite": "Atelier",
        "outils": [],
        "reglementation_normes": [],
        "mots_cles": [
          "leadership",
          "stress"
        ]
      },
      {
        "_id_sql": 81,
        "libelle": "Assurer disponibilité/astreintes en gérant charge mentale et récupération",
        "type_competence": "Physique",
        "indicateurs_observables": "Organisation repos, prévention épuisement",
        "modalite_evaluation": "Entretien",
        "preuves_attendues": "Plan prévention",
        "situations_professionnelles_type": "Astreinte week-end",
        "formation_activite": "Atelier",
        "outils": [],
        "reglementation_normes": [
          "Prévention RPS"
        ],
        "mots_cles": [
          "astreinte",
          "fatigue"
        ]
      }
    ]
  },
  {
    "_id": "metier_13",
    "metier_id": 13,
    "nom_metier": "Affréteur",
    "domaine": {
      "domaine_id": 4,
      "nom_domaine": "4. PLANIFIER & COORDONNER"
    },
    "nb_competences": 6,
    "competences": [
      {
        "_id_sql": 82,
        "libelle": "Utiliser une bourse de fret et qualifier une offre/demande",
        "type_competence": "Technique",
        "indicateurs_observables": "Offres pertinentes, critères complets, réactivité",
        "modalite_evaluation": "Étude de cas + simulation",
        "preuves_attendues": "Dossier affrètement",
        "situations_professionnelles_type": "Lot spot",
        "formation_activite": "TP",
        "outils": [
          "Bourse de fret"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "affrètement",
          "spot"
        ]
      },
      {
        "_id_sql": 83,
        "libelle": "Appliquer Incoterms et bases de droit commercial dans la vente/achat transport",
        "type_competence": "Technique",
        "indicateurs_observables": "Incoterm correct, responsabilités clarifiées",
        "modalite_evaluation": "QCM + cas",
        "preuves_attendues": "Correction cas",
        "situations_professionnelles_type": "Export UE",
        "formation_activite": "TD",
        "outils": [],
        "reglementation_normes": [
          "Incoterms"
        ],
        "mots_cles": [
          "droit",
          "incoterms"
        ]
      },
      {
        "_id_sql": 84,
        "libelle": "Construire et animer un réseau de sous-traitants",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Base qualifiée, évaluations, continuité service",
        "modalite_evaluation": "Projet",
        "preuves_attendues": "Base sous-traitants",
        "situations_professionnelles_type": "Saisonnalité",
        "formation_activite": "Projet",
        "outils": [
          "CRM/Excel"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "réseau",
          "sous-traitance"
        ]
      },
      {
        "_id_sql": 85,
        "libelle": "Suivre la marge par dossier et piloter la profitabilité",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Marge calculée, alertes, actions",
        "modalite_evaluation": "Étude de cas chiffrée",
        "preuves_attendues": "Tableau marge",
        "situations_professionnelles_type": "Dossier déficitaire",
        "formation_activite": "TD",
        "outils": [
          "Excel"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "marge",
          "profitabilité"
        ]
      },
      {
        "_id_sql": 86,
        "libelle": "Développer ténacité commerciale, persuasion et réactivité",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Argumentaire, relances, gestion objections",
        "modalite_evaluation": "Jeu de rôle",
        "preuves_attendues": "Grille soft skills",
        "situations_professionnelles_type": "Négociation prix",
        "formation_activite": "Jeu de rôle",
        "outils": [
          "Téléphone"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "commercial",
          "persuasion"
        ]
      },
      {
        "_id_sql": 87,
        "libelle": "Soutenir un travail sédentaire intensif (téléphone/écran) et gérer fatigue",
        "type_competence": "Physique",
        "indicateurs_observables": "Hygiène posture, gestion attention",
        "modalite_evaluation": "Auto-évaluation",
        "preuves_attendues": "Plan prévention",
        "situations_professionnelles_type": "Journée appels",
        "formation_activite": "Module",
        "outils": [],
        "reglementation_normes": [
          "Ergonomie"
        ],
        "mots_cles": [
          "fatigue visuelle",
          "posture"
        ]
      }
    ]
  },
  {
    "_id": "metier_14",
    "metier_id": 14,
    "nom_metier": "Demand Planner (Prévisionniste)",
    "domaine": {
      "domaine_id": 4,
      "nom_domaine": "4. PLANIFIER & COORDONNER"
    },
    "nb_competences": 6,
    "competences": [
      {
        "_id_sql": 88,
        "libelle": "Modéliser statistiquement la demande et choisir un modèle adapté",
        "type_competence": "Technique",
        "indicateurs_observables": "Choix modèle justifié, backtesting, MAPE suivi",
        "modalite_evaluation": "Projet data + soutenance",
        "preuves_attendues": "Rapport + fichiers",
        "situations_professionnelles_type": "Série saisonnière",
        "formation_activite": "Projet data",
        "outils": [
          "Excel/Python/R"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "forecast",
          "stats"
        ]
      },
      {
        "_id_sql": 89,
        "libelle": "Maîtriser Excel avancé (TCD, fonctions, VBA si pertinent) pour automatiser analyses",
        "type_competence": "Technique",
        "indicateurs_observables": "Fichiers robustes, automatisations, contrôle erreurs",
        "modalite_evaluation": "TP Excel",
        "preuves_attendues": "Fichier Excel annoté",
        "situations_professionnelles_type": "Conso données",
        "formation_activite": "TP",
        "outils": [
          "Excel/VBA"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "Excel",
          "VBA"
        ]
      },
      {
        "_id_sql": 90,
        "libelle": "Utiliser un ERP (SAP/APO ou équivalent) pour données prévision/plan",
        "type_competence": "Technique",
        "indicateurs_observables": "Données extraites, cohérence, paramétrage basique",
        "modalite_evaluation": "TP outil / cas",
        "preuves_attendues": "Exports ERP",
        "situations_professionnelles_type": "Cycle mensuel",
        "formation_activite": "TP",
        "outils": [
          "ERP"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "ERP",
          "SAP"
        ]
      },
      {
        "_id_sql": 91,
        "libelle": "Contribuer au processus S&OP et coordonner ventes/production/logistique",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Rituels tenus, inputs complets, décisions tracées",
        "modalite_evaluation": "Jeu de rôle S&OP",
        "preuves_attendues": "CR S&OP",
        "situations_professionnelles_type": "Réunion mensuelle",
        "formation_activite": "Serious game",
        "outils": [
          "BI",
          "ERP"
        ],
        "reglementation_normes": [
          "S&OP"
        ],
        "mots_cles": [
          "coordination",
          "s&op"
        ]
      },
      {
        "_id_sql": 92,
        "libelle": "Formuler des recommandations chiffrées et argumentées (force de proposition)",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Recommandations claires, impact coût/service",
        "modalite_evaluation": "Oral + dossier",
        "preuves_attendues": "Note d",
        "situations_professionnelles_type": "Rupture vs stock",
        "formation_activite": "Oral",
        "outils": [
          "Excel/BI"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "analyse",
          "recommandation"
        ]
      },
      {
        "_id_sql": 93,
        "libelle": "Soutenir concentration visuelle et charge cognitive sur écran",
        "type_competence": "Physique",
        "indicateurs_observables": "Gestion pauses, qualité attention",
        "modalite_evaluation": "Auto-évaluation",
        "preuves_attendues": "Plan prévention",
        "situations_professionnelles_type": "Travail data",
        "formation_activite": "Module",
        "outils": [],
        "reglementation_normes": [
          "Ergonomie"
        ],
        "mots_cles": [
          "fatigue visuelle"
        ]
      }
    ]
  },
  {
    "_id": "metier_15",
    "metier_id": 15,
    "nom_metier": "Gestionnaire de Stocks",
    "domaine": {
      "domaine_id": 4,
      "nom_domaine": "4. PLANIFIER & COORDONNER"
    },
    "nb_competences": 7,
    "competences": [
      {
        "_id_sql": 94,
        "libelle": "Appliquer les méthodes FIFO/ABC et analyser la rotation des stocks",
        "type_competence": "Technique",
        "indicateurs_observables": "Classement ABC correct, respect FIFO, rotation mesurée",
        "modalite_evaluation": "Étude de cas",
        "preuves_attendues": "Analyse rotation",
        "situations_professionnelles_type": "Produit périssable",
        "formation_activite": "TD",
        "outils": [
          "Excel/WMS"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "ABC",
          "FIFO"
        ]
      },
      {
        "_id_sql": 95,
        "libelle": "Réaliser des inventaires (tournants/généraux) et traiter écarts",
        "type_competence": "Technique",
        "indicateurs_observables": "Procédure correcte, écarts analysés, actions",
        "modalite_evaluation": "Mise en situation + audit",
        "preuves_attendues": "PV inventaire",
        "situations_professionnelles_type": "Inventaire tournant",
        "formation_activite": "TP",
        "outils": [
          "WMS"
        ],
        "reglementation_normes": [
          "Procédures inventaire"
        ],
        "mots_cles": [
          "inventaire",
          "écarts"
        ]
      },
      {
        "_id_sql": 96,
        "libelle": "Paramétrer des règles WMS (seuils, emplacements, statuts) niveau utilisateur",
        "type_competence": "Technique",
        "indicateurs_observables": "Paramétrage cohérent, test, documentation",
        "modalite_evaluation": "TP WMS",
        "preuves_attendues": "Paramétrage + captures",
        "situations_professionnelles_type": "Réglage réassort",
        "formation_activite": "TP",
        "outils": [
          "WMS"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "paramétrage WMS"
        ]
      },
      {
        "_id_sql": 97,
        "libelle": "Calculer des seuils de réapprovisionnement et proposer politiques stock",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Seuils justifiés, prise en compte délai/service",
        "modalite_evaluation": "Étude de cas chiffrée",
        "preuves_attendues": "Calculs + note",
        "situations_professionnelles_type": "Variation demande",
        "formation_activite": "TD",
        "outils": [
          "Excel"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "réappro",
          "stock de sécurité"
        ]
      },
      {
        "_id_sql": 98,
        "libelle": "Optimiser la surface et l stockage",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Gain espace, réduction déplacements",
        "modalite_evaluation": "Projet implantation",
        "preuves_attendues": "Plan + KPI",
        "situations_professionnelles_type": "Réaménagement zone",
        "formation_activite": "Projet",
        "outils": [
          "Plan",
          "WMS"
        ],
        "reglementation_normes": [
          "5S/Lean (bases)"
        ],
        "mots_cles": [
          "implantation",
          "surface"
        ]
      },
      {
        "_id_sql": 99,
        "libelle": "Faire preuve de méthode, anticipation et sens de l’économie",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Priorités claires, décisions sobres, rigueur",
        "modalite_evaluation": "Entretien + cas",
        "preuves_attendues": "Plan d",
        "situations_professionnelles_type": "Budget serré",
        "formation_activite": "Exercice",
        "outils": [],
        "reglementation_normes": [],
        "mots_cles": [
          "anticipation",
          "méthode"
        ]
      },
      {
        "_id_sql": 100,
        "libelle": "Assurer déplacements entrepôt en sécurité (circulation, coactivité)",
        "type_competence": "Physique",
        "indicateurs_observables": "Respect règles, vigilance",
        "modalite_evaluation": "Observation",
        "preuves_attendues": "Audit sécurité",
        "situations_professionnelles_type": "Visite zones",
        "formation_activite": "Visite",
        "outils": [
          "EPI"
        ],
        "reglementation_normes": [
          "Sécurité site"
        ],
        "mots_cles": [
          "coactivité",
          "sécurité"
        ]
      }
    ]
  },
  {
    "_id": "metier_16",
    "metier_id": 16,
    "nom_metier": "Responsable Douane",
    "domaine": {
      "domaine_id": 5,
      "nom_domaine": "5. ANALYSER & CONSEILLER"
    },
    "nb_competences": 7,
    "competences": [
      {
        "_id_sql": 101,
        "libelle": "Appliquer le Code des douanes (CDU) et déterminer le régime applicable",
        "type_competence": "Technique",
        "indicateurs_observables": "Régime correct, justification, documentation",
        "modalite_evaluation": "Étude de cas + QCM",
        "preuves_attendues": "Dossier douane",
        "situations_professionnelles_type": "Import hors UE",
        "formation_activite": "TD",
        "outils": [],
        "reglementation_normes": [
          "CDU"
        ],
        "mots_cles": [
          "CDU",
          "douane"
        ]
      },
      {
        "_id_sql": 102,
        "libelle": "Réaliser un classement tarifaire (SH) et calculer droits/taxes",
        "type_competence": "Technique",
        "indicateurs_observables": "Code SH justifié, calcul correct",
        "modalite_evaluation": "Cas chiffré",
        "preuves_attendues": "Fiche classement",
        "situations_professionnelles_type": "Produit complexe",
        "formation_activite": "TD",
        "outils": [
          "Bases douanières"
        ],
        "reglementation_normes": [
          "TARIC (principes)"
        ],
        "mots_cles": [
          "SH",
          "tarifaire"
        ]
      },
      {
        "_id_sql": 103,
        "libelle": "Utiliser les procédures DELTA/OEA et préparer dossiers de conformité",
        "type_competence": "Technique",
        "indicateurs_observables": "Dossiers complets, traçabilité, conformité",
        "modalite_evaluation": "TP procédure + cas",
        "preuves_attendues": "Dossier conformité",
        "situations_professionnelles_type": "Audit interne",
        "formation_activite": "TP",
        "outils": [
          "Outils déclaratifs"
        ],
        "reglementation_normes": [
          "DELTA/OEA"
        ],
        "mots_cles": [
          "DELTA",
          "OEA"
        ]
      },
      {
        "_id_sql": 104,
        "libelle": "Assurer veille réglementaire et gérer contentieux/contrôles",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Veille structurée, réponses délais, preuves",
        "modalite_evaluation": "Étude de cas",
        "preuves_attendues": "Note de veille",
        "situations_professionnelles_type": "Contrôle douane",
        "formation_activite": "Projet veille",
        "outils": [],
        "reglementation_normes": [
          "Réglementation"
        ],
        "mots_cles": [
          "contentieux",
          "veille"
        ]
      },
      {
        "_id_sql": 105,
        "libelle": "Réaliser des audits de conformité et plans d’actions",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Plan audit, constats factuels, actions suivies",
        "modalite_evaluation": "Projet",
        "preuves_attendues": "Rapport audit",
        "situations_professionnelles_type": "Audit OEA",
        "formation_activite": "Projet",
        "outils": [
          "Check-lists"
        ],
        "reglementation_normes": [
          "OEA"
        ],
        "mots_cles": [
          "audit",
          "conformité"
        ]
      },
      {
        "_id_sql": 106,
        "libelle": "Agir avec intégrité, rigueur administrative et diplomatie",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Dossiers impeccables, échanges apaisés",
        "modalite_evaluation": "Entretien + cas",
        "preuves_attendues": "Grille soft skills",
        "situations_professionnelles_type": "Litige",
        "formation_activite": "Cas",
        "outils": [],
        "reglementation_normes": [
          "Déontologie"
        ],
        "mots_cles": [
          "diplomatie",
          "intégrité"
        ]
      },
      {
        "_id_sql": 107,
        "libelle": "Soutenir un travail de bureau prolongé (organisation, fatigue)",
        "type_competence": "Physique",
        "indicateurs_observables": "Gestion temps, pauses, ergonomie",
        "modalite_evaluation": "Auto-évaluation",
        "preuves_attendues": "Plan prévention",
        "situations_professionnelles_type": "Semaine de clôture",
        "formation_activite": "Module",
        "outils": [],
        "reglementation_normes": [
          "Ergonomie"
        ],
        "mots_cles": [
          "bureau",
          "ergonomie"
        ]
      }
    ]
  },
  {
    "_id": "metier_17",
    "metier_id": 17,
    "nom_metier": "Consultant Logistique / Ingénieur Méthodes",
    "domaine": {
      "domaine_id": 5,
      "nom_domaine": "5. ANALYSER & CONSEILLER"
    },
    "nb_competences": 7,
    "competences": [
      {
        "_id_sql": 108,
        "libelle": "Analyser des flux et modéliser des processus logistiques",
        "type_competence": "Technique",
        "indicateurs_observables": "Cartographie correcte, goulots identifiés",
        "modalite_evaluation": "Étude de cas + projet",
        "preuves_attendues": "VSM/Process map",
        "situations_professionnelles_type": "Entrepôt saturé",
        "formation_activite": "Projet",
        "outils": [
          "Outils mapping"
        ],
        "reglementation_normes": [
          "Lean (bases)"
        ],
        "mots_cles": [
          "flux",
          "processus"
        ]
      },
      {
        "_id_sql": 109,
        "libelle": "Réaliser une simulation de flux et interpréter résultats",
        "type_competence": "Technique",
        "indicateurs_observables": "Hypothèses claires, résultats interprétés",
        "modalite_evaluation": "Projet simulation",
        "preuves_attendues": "Fichier simulation + rapport",
        "situations_professionnelles_type": "Scénarios capacité",
        "formation_activite": "Projet",
        "outils": [
          "Outil simulation/Excel"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "capacité",
          "simulation"
        ]
      },
      {
        "_id_sql": 110,
        "libelle": "Concevoir un design d’entrepôt (zones, capacités, flux)",
        "type_competence": "Technique",
        "indicateurs_observables": "Implantation cohérente, sécurité, KPI",
        "modalite_evaluation": "Projet",
        "preuves_attendues": "Plan d",
        "situations_professionnelles_type": "Nouveau site",
        "formation_activite": "Projet",
        "outils": [
          "Outils DAO/Excel"
        ],
        "reglementation_normes": [
          "ICPE (sensibilisation)"
        ],
        "mots_cles": [
          "design",
          "entrepôt"
        ]
      },
      {
        "_id_sql": 111,
        "libelle": "Piloter un projet (planning, risques, parties prenantes) ",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Planning tenu, risques gérés, jalons",
        "modalite_evaluation": "Projet + soutenance",
        "preuves_attendues": "Charte projet",
        "situations_professionnelles_type": "WMS change",
        "formation_activite": "Projet",
        "outils": [
          "MS Project/Excel"
        ],
        "reglementation_normes": [
          "Gestion de projet"
        ],
        "mots_cles": [
          "planning",
          "project"
        ]
      },
      {
        "_id_sql": 112,
        "libelle": "Rédiger un cahier des charges et calculer un ROI",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "CDC complet, ROI cohérent, hypothèses",
        "modalite_evaluation": "Étude de cas",
        "preuves_attendues": "CDC + ROI",
        "situations_professionnelles_type": "Automatisation",
        "formation_activite": "TD",
        "outils": [
          "Excel"
        ],
        "reglementation_normes": [
          "Finance (bases)"
        ],
        "mots_cles": [
          "CDC",
          "ROI"
        ]
      },
      {
        "_id_sql": 113,
        "libelle": "Conduire le changement avec pédagogie et logique",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Plan com, écoute, adaptation",
        "modalite_evaluation": "Jeu de rôle",
        "preuves_attendues": "Plan changement",
        "situations_professionnelles_type": "Résistance terrain",
        "formation_activite": "Atelier",
        "outils": [],
        "reglementation_normes": [],
        "mots_cles": [
          "change",
          "pédagogie"
        ]
      },
      {
        "_id_sql": 114,
        "libelle": "Gérer alternance sédentarité/déplacements en autonomie",
        "type_competence": "Physique",
        "indicateurs_observables": "Organisation déplacements, fatigue",
        "modalite_evaluation": "Auto-évaluation",
        "preuves_attendues": "Plan prévention",
        "situations_professionnelles_type": "Mission client",
        "formation_activite": "Module",
        "outils": [],
        "reglementation_normes": [],
        "mots_cles": [
          "autonomie",
          "déplacement"
        ]
      }
    ]
  },
  {
    "_id": "metier_18",
    "metier_id": 18,
    "nom_metier": "Responsable QSE (Qualité Sécurité)",
    "domaine": {
      "domaine_id": 5,
      "nom_domaine": "5. ANALYSER & CONSEILLER"
    },
    "nb_competences": 6,
    "competences": [
      {
        "_id_sql": 115,
        "libelle": "Appliquer normes ISO pertinentes et construire un système documentaire",
        "type_competence": "Technique",
        "indicateurs_observables": "Procédures cohérentes, traçabilité, audits",
        "modalite_evaluation": "Projet",
        "preuves_attendues": "Manuel/process",
        "situations_professionnelles_type": "Certification",
        "formation_activite": "Projet",
        "outils": [
          "Outils QSE"
        ],
        "reglementation_normes": [
          "ISO"
        ],
        "mots_cles": [
          "ISO",
          "qualité"
        ]
      },
      {
        "_id_sql": 116,
        "libelle": "Appliquer réglementation TMD (marchandises dangereuses) et mesures de prévention",
        "type_competence": "Technique",
        "indicateurs_observables": "Classement, étiquetage, procédures",
        "modalite_evaluation": "Étude de cas + QCM",
        "preuves_attendues": "Dossier TMD",
        "situations_professionnelles_type": "Expédition ADR",
        "formation_activite": "TD",
        "outils": [],
        "reglementation_normes": [
          "TMD/ADR (principes)"
        ],
        "mots_cles": [
          "ADR",
          "TMD"
        ]
      },
      {
        "_id_sql": 117,
        "libelle": "Évaluer risques et tenir à jour le Document Unique",
        "type_competence": "Technique",
        "indicateurs_observables": "DUERP complet, plan actions",
        "modalite_evaluation": "Projet",
        "preuves_attendues": "DUERP",
        "situations_professionnelles_type": "Entrepôt",
        "formation_activite": "Projet",
        "outils": [
          "Outils DUERP"
        ],
        "reglementation_normes": [
          "DUERP"
        ],
        "mots_cles": [
          "DUERP",
          "risques"
        ]
      },
      {
        "_id_sql": 118,
        "libelle": "Animer la sécurité (causeries, audits internes, prévention)",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Rituels, indicateurs, actions suivies",
        "modalite_evaluation": "Mise en situation + audit",
        "preuves_attendues": "Compte-rendu",
        "situations_professionnelles_type": "Animation site",
        "formation_activite": "Atelier",
        "outils": [
          "Check-lists"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "animation",
          "sécurité"
        ]
      },
      {
        "_id_sql": 119,
        "libelle": "Adopter fermeté, pédagogie et sens de l’observation",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Recadrage factuel, écoute, observations pertinentes",
        "modalite_evaluation": "Jeu de rôle",
        "preuves_attendues": "Grille soft skills",
        "situations_professionnelles_type": "Écart EPI",
        "formation_activite": "Jeu de rôle",
        "outils": [],
        "reglementation_normes": [],
        "mots_cles": [
          "fermeté",
          "pédagogie"
        ]
      },
      {
        "_id_sql": 120,
        "libelle": "Assurer des déplacements fréquents sur site en sécurité",
        "type_competence": "Physique",
        "indicateurs_observables": "EPI, vigilance coactivité",
        "modalite_evaluation": "Observation",
        "preuves_attendues": "Audit",
        "situations_professionnelles_type": "Tournée terrain",
        "formation_activite": "Visite",
        "outils": [
          "EPI"
        ],
        "reglementation_normes": [
          "Sécurité"
        ],
        "mots_cles": [
          "coactivité",
          "terrain"
        ]
      }
    ]
  },
  {
    "_id": "metier_19",
    "metier_id": 19,
    "nom_metier": "Commercial Transport",
    "domaine": {
      "domaine_id": 6,
      "nom_domaine": "6. NÉGOCIER"
    },
    "nb_competences": 6,
    "competences": [
      {
        "_id_sql": 121,
        "libelle": "Construire une offre transport (cotation) et chiffrer un dossier",
        "type_competence": "Technique",
        "indicateurs_observables": "Devis cohérent, marge, contraintes",
        "modalite_evaluation": "Étude de cas chiffrée",
        "preuves_attendues": "Devis",
        "situations_professionnelles_type": "Appel d",
        "formation_activite": "TD",
        "outils": [
          "CRM/Excel"
        ],
        "reglementation_normes": [
          "Incoterms (bases)"
        ],
        "mots_cles": [
          "cotation",
          "pricing"
        ]
      },
      {
        "_id_sql": 122,
        "libelle": "Utiliser un CRM pour prospecter, suivre pipeline et relances",
        "type_competence": "Technique",
        "indicateurs_observables": "Pipeline à jour, taux relance, qualité données",
        "modalite_evaluation": "TP CRM",
        "preuves_attendues": "Exports CRM",
        "situations_professionnelles_type": "Prospection",
        "formation_activite": "TP",
        "outils": [
          "CRM"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "CRM",
          "prospection"
        ]
      },
      {
        "_id_sql": 123,
        "libelle": "Prospecter et fidéliser un portefeuille (plan d’actions commercial)",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Plan structuré, objectifs, suivi",
        "modalite_evaluation": "Projet",
        "preuves_attendues": "Plan commercial",
        "situations_professionnelles_type": "Trimestre",
        "formation_activite": "Projet",
        "outils": [
          "CRM"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "fidélisation",
          "prospection"
        ]
      },
      {
        "_id_sql": 124,
        "libelle": "Répondre à un appel d’offres (lecture, exigences, soutenance)",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Conformité dossier, argumentaire, délais",
        "modalite_evaluation": "Projet + soutenance",
        "preuves_attendues": "Dossier AO",
        "situations_professionnelles_type": "AO public/privé",
        "formation_activite": "Projet",
        "outils": [
          "Outils bureautiques"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "appel d soutenance"
        ]
      },
      {
        "_id_sql": 125,
        "libelle": "Développer écoute, persévérance et sens du contact",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Questions pertinentes, gestion objections",
        "modalite_evaluation": "Jeu de rôle",
        "preuves_attendues": "Grille soft skills",
        "situations_professionnelles_type": "Négociation",
        "formation_activite": "Jeu de rôle",
        "outils": [
          "Téléphone"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "persuasion",
          "écoute"
        ]
      },
      {
        "_id_sql": 126,
        "libelle": "Assurer mobilité (permis B) et déplacements clientèle en sécurité",
        "type_competence": "Physique",
        "indicateurs_observables": "Organisation trajets, sécurité",
        "modalite_evaluation": "Auto-évaluation",
        "preuves_attendues": "Plan déplacements",
        "situations_professionnelles_type": "Visites clients",
        "formation_activite": "Module",
        "outils": [
          "Véhicule"
        ],
        "reglementation_normes": [
          "Sécurité routière"
        ],
        "mots_cles": [
          "déplacements",
          "sécurité"
        ]
      }
    ]
  },
  {
    "_id": "metier_20",
    "metier_id": 20,
    "nom_metier": "Agent Maritime (Consignataire)",
    "domaine": {
      "domaine_id": 6,
      "nom_domaine": "6. NÉGOCIER"
    },
    "nb_competences": 5,
    "competences": [
      {
        "_id_sql": 127,
        "libelle": "Appliquer réglementation maritime et gérer formalités d’escale",
        "type_competence": "Technique",
        "indicateurs_observables": "Dossier escale complet, conformité",
        "modalite_evaluation": "Étude de cas",
        "preuves_attendues": "Dossier escale",
        "situations_professionnelles_type": "Arrivée navire",
        "formation_activite": "TD",
        "outils": [
          "Outils portuaires"
        ],
        "reglementation_normes": [
          "Règles portuaires"
        ],
        "mots_cles": [
          "consignation",
          "escale"
        ]
      },
      {
        "_id_sql": 128,
        "libelle": "Communiquer en anglais technique maritime (écrit/oral)",
        "type_competence": "Technique",
        "indicateurs_observables": "Messages clairs, vocabulaire, compréhension",
        "modalite_evaluation": "Oral + écrit",
        "preuves_attendues": "Email type + simulation appel",
        "situations_professionnelles_type": "Coordination port",
        "formation_activite": "Atelier",
        "outils": [
          "Email/téléphone"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "anglais",
          "maritime"
        ]
      },
      {
        "_id_sql": 129,
        "libelle": "Coordonner opérations portuaires avec multiples acteurs",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Planning synchronisé, incidents gérés",
        "modalite_evaluation": "Simulation",
        "preuves_attendues": "CR coordination",
        "situations_professionnelles_type": "Escale complexe",
        "formation_activite": "Serious game",
        "outils": [
          "Outils planning"
        ],
        "reglementation_normes": [
          "Autorités portuaires"
        ],
        "mots_cles": [
          "coordination",
          "port"
        ]
      },
      {
        "_id_sql": 130,
        "libelle": "Gérer relations autorités portuaires avec disponibilité et réactivité",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Réponses rapides, diplomatie, fiabilité",
        "modalite_evaluation": "Jeu de rôle",
        "preuves_attendues": "Grille soft skills",
        "situations_professionnelles_type": "Contrôle",
        "formation_activite": "Jeu de rôle",
        "outils": [],
        "reglementation_normes": [],
        "mots_cles": [
          "diplomatie",
          "réactivité"
        ]
      },
      {
        "_id_sql": 131,
        "libelle": "S’adapter à horaires décalés et charge de travail variable",
        "type_competence": "Physique",
        "indicateurs_observables": "Gestion repos, organisation",
        "modalite_evaluation": "Auto-évaluation",
        "preuves_attendues": "Plan prévention",
        "situations_professionnelles_type": "Arrivées nocturnes",
        "formation_activite": "Module",
        "outils": [],
        "reglementation_normes": [
          "Prévention fatigue"
        ],
        "mots_cles": [
          "fatigue",
          "horaires"
        ]
      }
    ]
  },
  {
    "_id": "metier_21",
    "metier_id": 21,
    "nom_metier": "Supply Chain Manager",
    "domaine": {
      "domaine_id": 7,
      "nom_domaine": "7. ENCADRER & DIRIGER"
    },
    "nb_competences": 7,
    "competences": [
      {
        "_id_sql": 132,
        "libelle": "Construire une stratégie S&OP et aligner objectifs service/coût/cash",
        "type_competence": "Technique",
        "indicateurs_observables": "Stratégie formalisée, arbitrages, KPI",
        "modalite_evaluation": "Projet + soutenance",
        "preuves_attendues": "Note stratégique",
        "situations_professionnelles_type": "Entreprise multi-sites",
        "formation_activite": "Projet",
        "outils": [
          "BI/ERP"
        ],
        "reglementation_normes": [
          "Gouvernance S&OP"
        ],
        "mots_cles": [
          "S&OP",
          "stratégie"
        ]
      },
      {
        "_id_sql": 133,
        "libelle": "Piloter la performance financière supply (budget, coûts, stocks)",
        "type_competence": "Technique",
        "indicateurs_observables": "Budget, analyses écarts, actions",
        "modalite_evaluation": "Étude de cas chiffrée",
        "preuves_attendues": "Dashboard finance",
        "situations_professionnelles_type": "Revue mensuelle",
        "formation_activite": "TD",
        "outils": [
          "BI/Excel"
        ],
        "reglementation_normes": [
          "Contrôle de gestion"
        ],
        "mots_cles": [
          "finance",
          "pilotage"
        ]
      },
      {
        "_id_sql": 134,
        "libelle": "Maîtriser les SI (ERP/WMS) pour piloter flux et données",
        "type_competence": "Technique",
        "indicateurs_observables": "Données fiables, indicateurs, gouvernance",
        "modalite_evaluation": "Projet data",
        "preuves_attendues": "Data dictionary",
        "situations_professionnelles_type": "Qualité données",
        "formation_activite": "Projet",
        "outils": [
          "ERP/WMS"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "SI",
          "data"
        ]
      },
      {
        "_id_sql": 135,
        "libelle": "Piloter transversalement et manager des managers (gouvernance)",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Rituels, décisions, alignement",
        "modalite_evaluation": "Jeu de rôle comité",
        "preuves_attendues": "CR comité",
        "situations_professionnelles_type": "Comité direction supply",
        "formation_activite": "Simulation",
        "outils": [
          "Outils management"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "gouvernance",
          "transversal"
        ]
      },
      {
        "_id_sql": 136,
        "libelle": "Mettre en œuvre Lean Management (amélioration continue)",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Chantiers, gains, standardisation",
        "modalite_evaluation": "Projet",
        "preuves_attendues": "A3/Kaizen",
        "situations_professionnelles_type": "Réduction lead time",
        "formation_activite": "Projet",
        "outils": [
          "Outils Lean"
        ],
        "reglementation_normes": [
          "Lean"
        ],
        "mots_cles": [
          "kaizen",
          "lean"
        ]
      },
      {
        "_id_sql": 137,
        "libelle": "Développer vision stratégique, leadership et capacité à fédérer",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Vision claire, mobilisation, communication",
        "modalite_evaluation": "Soutenance + entretien",
        "preuves_attendues": "Pitch vision",
        "situations_professionnelles_type": "Transformation",
        "formation_activite": "Atelier",
        "outils": [],
        "reglementation_normes": [],
        "mots_cles": [
          "leadership",
          "vision"
        ]
      },
      {
        "_id_sql": 138,
        "libelle": "Gérer stress et déplacements liés aux enjeux",
        "type_competence": "Physique",
        "indicateurs_observables": "Gestion charge, organisation",
        "modalite_evaluation": "Auto-évaluation",
        "preuves_attendues": "Plan prévention",
        "situations_professionnelles_type": "Déplacements sites",
        "formation_activite": "Module",
        "outils": [],
        "reglementation_normes": [
          "Prévention RPS"
        ],
        "mots_cles": [
          "déplacements",
          "stress"
        ]
      }
    ]
  },
  {
    "_id": "metier_22",
    "metier_id": 22,
    "nom_metier": "Responsable d'Entrepôt",
    "domaine": {
      "domaine_id": 7,
      "nom_domaine": "7. ENCADRER & DIRIGER"
    },
    "nb_competences": 8,
    "competences": [
      {
        "_id_sql": 139,
        "libelle": "Piloter la production logistique (réception, stockage, préparation, expédition)",
        "type_competence": "Technique",
        "indicateurs_observables": "KPI tenue, organisation, qualité",
        "modalite_evaluation": "Étude de cas + projet",
        "preuves_attendues": "Tableau de bord",
        "situations_professionnelles_type": "Pic saison",
        "formation_activite": "Projet",
        "outils": [
          "WMS"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "entrepôt",
          "pilotage"
        ]
      },
      {
        "_id_sql": 140,
        "libelle": "Appliquer sécurité et contraintes ICPE si applicable",
        "type_competence": "Technique",
        "indicateurs_observables": "Conformité, plans prévention, audits",
        "modalite_evaluation": "Étude de cas",
        "preuves_attendues": "Plan sécurité",
        "situations_professionnelles_type": "Site classé",
        "formation_activite": "TD",
        "outils": [
          "Docs sécurité"
        ],
        "reglementation_normes": [
          "ICPE (sensibilisation)"
        ],
        "mots_cles": [
          "ICPE",
          "sécurité"
        ]
      },
      {
        "_id_sql": 141,
        "libelle": "Appliquer bases du droit du travail (temps, discipline, IRP) ",
        "type_competence": "Technique",
        "indicateurs_observables": "Décisions conformes, traçabilité",
        "modalite_evaluation": "QCM + cas",
        "preuves_attendues": "Note RH",
        "situations_professionnelles_type": "Conflit planning",
        "formation_activite": "TD",
        "outils": [],
        "reglementation_normes": [
          "Droit du travail"
        ],
        "mots_cles": [
          "RH",
          "droit"
        ]
      },
      {
        "_id_sql": 142,
        "libelle": "Dimensionner équipes et planifier les ressources",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Capacité calculée, planning, polyvalence",
        "modalite_evaluation": "Étude de cas",
        "preuves_attendues": "Plan effectifs",
        "situations_professionnelles_type": "Semaine haute",
        "formation_activite": "TD",
        "outils": [
          "Excel"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "dimensionnement",
          "planning"
        ]
      },
      {
        "_id_sql": 143,
        "libelle": "Piloter KPI et animer routines terrain (QRQC, brief)",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Rituels, actions, amélioration KPI",
        "modalite_evaluation": "Mise en situation",
        "preuves_attendues": "CR routine",
        "situations_professionnelles_type": "Brief matin",
        "formation_activite": "Atelier",
        "outils": [
          "Tableaux"
        ],
        "reglementation_normes": [
          "Lean (bases)"
        ],
        "mots_cles": [
          "KPI",
          "routine"
        ]
      },
      {
        "_id_sql": 144,
        "libelle": "Gérer relations IRP et communication interne",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Communication structurée, respect cadre",
        "modalite_evaluation": "Jeu de rôle",
        "preuves_attendues": "CR réunion",
        "situations_professionnelles_type": "Réunion IRP",
        "formation_activite": "Jeu de rôle",
        "outils": [],
        "reglementation_normes": [
          "Cadre social"
        ],
        "mots_cles": [
          "IRP",
          "social"
        ]
      },
      {
        "_id_sql": 145,
        "libelle": "Incarner exemplarité, charisme et fermeté",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Recadrages factuels, justice, cohérence",
        "modalite_evaluation": "Jeu de rôle + entretien",
        "preuves_attendues": "Grille soft skills",
        "situations_professionnelles_type": "Écart sécurité",
        "formation_activite": "Atelier",
        "outils": [],
        "reglementation_normes": [],
        "mots_cles": [
          "exemplarité",
          "fermeté"
        ]
      },
      {
        "_id_sql": 146,
        "libelle": "Soutenir endurance terrain et horaires étendus",
        "type_competence": "Physique",
        "indicateurs_observables": "Gestion fatigue, organisation",
        "modalite_evaluation": "Auto-évaluation",
        "preuves_attendues": "Plan prévention",
        "situations_professionnelles_type": "Semaine pic",
        "formation_activite": "Module",
        "outils": [],
        "reglementation_normes": [
          "Prévention fatigue"
        ],
        "mots_cles": [
          "endurance",
          "horaires"
        ]
      }
    ]
  },
  {
    "_id": "metier_23",
    "metier_id": 23,
    "nom_metier": "Responsable d'Agence Transport",
    "domaine": {
      "domaine_id": 7,
      "nom_domaine": "7. ENCADRER & DIRIGER"
    },
    "nb_competences": 6,
    "competences": [
      {
        "_id_sql": 147,
        "libelle": "Piloter un centre de profit (P&L) et analyser rentabilité",
        "type_competence": "Technique",
        "indicateurs_observables": "Lecture P&L, actions marge, budget",
        "modalite_evaluation": "Étude de cas chiffrée",
        "preuves_attendues": "Analyse P&L",
        "situations_professionnelles_type": "Agence déficitaire",
        "formation_activite": "TD",
        "outils": [
          "Excel/BI"
        ],
        "reglementation_normes": [
          "Contrôle de gestion"
        ],
        "mots_cles": [
          "P&L",
          "rentabilité"
        ]
      },
      {
        "_id_sql": 148,
        "libelle": "Développer commercialement l’agence (plan d’action, offres)",
        "type_competence": "Technique",
        "indicateurs_observables": "Plan commercial, pipeline, résultats",
        "modalite_evaluation": "Projet",
        "preuves_attendues": "Plan action",
        "situations_professionnelles_type": "Développement zone",
        "formation_activite": "Projet",
        "outils": [
          "CRM"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "commercial",
          "développement"
        ]
      },
      {
        "_id_sql": 149,
        "libelle": "Piloter opérations et superviser exploitation au quotidien",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Service tenu, aléas gérés, coordination",
        "modalite_evaluation": "Simulation",
        "preuves_attendues": "CR",
        "situations_professionnelles_type": "Crise capacité",
        "formation_activite": "Serious game",
        "outils": [
          "TMS"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "opérations",
          "supervision"
        ]
      },
      {
        "_id_sql": 150,
        "libelle": "Piloter RH (recrutement, intégration, discipline, compétences)",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Process RH, intégration, suivi",
        "modalite_evaluation": "Étude de cas",
        "preuves_attendues": "Parcours intégration",
        "situations_professionnelles_type": "Turnover",
        "formation_activite": "TD",
        "outils": [
          "Outils RH"
        ],
        "reglementation_normes": [
          "Droit du travail (bases)"
        ],
        "mots_cles": [
          "RH",
          "compétences"
        ]
      },
      {
        "_id_sql": 151,
        "libelle": "Développer esprit entrepreneurial, polyvalence et sens politique",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Initiatives, arbitrages, gestion parties prenantes",
        "modalite_evaluation": "Entretien + cas",
        "preuves_attendues": "Note décision",
        "situations_professionnelles_type": "Conflit interne",
        "formation_activite": "Atelier",
        "outils": [],
        "reglementation_normes": [],
        "mots_cles": [
          "entrepreneurial",
          "stakeholders"
        ]
      },
      {
        "_id_sql": 152,
        "libelle": "Assurer disponibilité importante en gérant charge et équilibre",
        "type_competence": "Physique",
        "indicateurs_observables": "Organisation, prévention épuisement",
        "modalite_evaluation": "Auto-évaluation",
        "preuves_attendues": "Plan prévention",
        "situations_professionnelles_type": "Semaine dense",
        "formation_activite": "Module",
        "outils": [],
        "reglementation_normes": [
          "Prévention RPS"
        ],
        "mots_cles": [
          "disponibilité",
          "stress"
        ]
      }
    ]
  },
  {
    "_id": "metier_24",
    "metier_id": 24,
    "nom_metier": "Logisticien Humanitaire",
    "domaine": {
      "domaine_id": 7,
      "nom_domaine": "7. ENCADRER & DIRIGER"
    },
    "nb_competences": 6,
    "competences": [
      {
        "_id_sql": 153,
        "libelle": "Organiser une logistique d’urgence (appro, distribution, priorités)",
        "type_competence": "Technique",
        "indicateurs_observables": "Priorisation, continuité, traçabilité",
        "modalite_evaluation": "Simulation crise",
        "preuves_attendues": "Plan logistique",
        "situations_professionnelles_type": "Catastrophe",
        "formation_activite": "Serious game",
        "outils": [
          "Outils terrain"
        ],
        "reglementation_normes": [
          "Standards humanitaires (sensibilisation)"
        ],
        "mots_cles": [
          "humanitaire",
          "urgence"
        ]
      },
      {
        "_id_sql": 154,
        "libelle": "Gérer une flotte et des ressources dégradées (maintenance, carburant)",
        "type_competence": "Technique",
        "indicateurs_observables": "Plan maintenance, suivi conso, arbitrages",
        "modalite_evaluation": "Étude de cas",
        "preuves_attendues": "Tableau flotte",
        "situations_professionnelles_type": "Zone isolée",
        "formation_activite": "Projet",
        "outils": [
          "Excel"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "flotte",
          "terrain"
        ]
      },
      {
        "_id_sql": 155,
        "libelle": "Réaliser des achats en contexte de crise et sécuriser la chaîne",
        "type_competence": "Technique",
        "indicateurs_observables": "Achats traçables, délais, contrôle",
        "modalite_evaluation": "Étude de cas",
        "preuves_attendues": "Dossier achat",
        "situations_professionnelles_type": "Pénurie",
        "formation_activite": "TD",
        "outils": [
          "Docs achats"
        ],
        "reglementation_normes": [
          "Procédures ONG (sensibilisation)"
        ],
        "mots_cles": [
          "achats",
          "crise"
        ]
      },
      {
        "_id_sql": 156,
        "libelle": "Coordonner multisite et travailler en système D (débrouillardise)",
        "type_competence": "Organisationnelle",
        "indicateurs_observables": "Solutions pragmatiques, coordination, reporting",
        "modalite_evaluation": "Simulation",
        "preuves_attendues": "CR situation",
        "situations_professionnelles_type": "Multi-camps",
        "formation_activite": "Serious game",
        "outils": [
          "Radio/messagerie"
        ],
        "reglementation_normes": [],
        "mots_cles": [
          "coordination",
          "système D"
        ]
      },
      {
        "_id_sql": 157,
        "libelle": "Faire preuve d’adaptabilité, altruisme et solidité psychologique",
        "type_competence": "Comportementale",
        "indicateurs_observables": "Comportement stable, coopération, gestion émotion",
        "modalite_evaluation": "Entretien + mise en situation",
        "preuves_attendues": "Grille soft skills",
        "situations_professionnelles_type": "Contexte tendu",
        "formation_activite": "Atelier",
        "outils": [],
        "reglementation_normes": [],
        "mots_cles": [
          "adaptabilité",
          "résilience"
        ]
      },
      {
        "_id_sql": 158,
        "libelle": "Tenir dans des conditions de vie difficiles (terrain) en sécurité",
        "type_competence": "Physique",
        "indicateurs_observables": "Hygiène, gestion fatigue, sécurité",
        "modalite_evaluation": "Auto-évaluation",
        "preuves_attendues": "Plan prévention",
        "situations_professionnelles_type": "Camp isolé",
        "formation_activite": "Module",
        "outils": [
          "EPI"
        ],
        "reglementation_normes": [
          "Prévention santé"
        ],
        "mots_cles": [
          "endurance",
          "terrain"
        ]
      }
    ]
  }
]
);

// =============================================================================
// 5. DATA — VOCABULAIRE (542 documents)
// =============================================================================
// Split into batches to avoid shell limits

db.vocabulaire.insertMany(
[
  {
    "_id": "type_1",
    "categorie": "type_competence",
    "code_id": 1,
    "libelle": "Technique"
  },
  {
    "_id": "type_2",
    "categorie": "type_competence",
    "code_id": 2,
    "libelle": "Organisationnelle"
  },
  {
    "_id": "type_3",
    "categorie": "type_competence",
    "code_id": 3,
    "libelle": "Comportementale"
  },
  {
    "_id": "type_4",
    "categorie": "type_competence",
    "code_id": 4,
    "libelle": "Physique"
  },
  {
    "_id": "modalite_1",
    "categorie": "modalite_evaluation",
    "code_id": 1,
    "libelle": "Mise en situation (simulateur/terrain) + grille observation"
  },
  {
    "_id": "modalite_2",
    "categorie": "modalite_evaluation",
    "code_id": 2,
    "libelle": "QCM + étude de cas panne + oral"
  },
  {
    "_id": "modalite_3",
    "categorie": "modalite_evaluation",
    "code_id": 3,
    "libelle": "Mise en situation atelier + audit"
  },
  {
    "_id": "modalite_4",
    "categorie": "modalite_evaluation",
    "code_id": 4,
    "libelle": "Étude de cas + exercice e-CMR"
  },
  {
    "_id": "modalite_5",
    "categorie": "modalite_evaluation",
    "code_id": 5,
    "libelle": "Étude de cas + QCM réglementaire"
  },
  {
    "_id": "modalite_6",
    "categorie": "modalite_evaluation",
    "code_id": 6,
    "libelle": "Étude de cas + simulation carto"
  },
  {
    "_id": "modalite_7",
    "categorie": "modalite_evaluation",
    "code_id": 7,
    "libelle": "Jeu de rôle + observation"
  },
  {
    "_id": "modalite_8",
    "categorie": "modalite_evaluation",
    "code_id": 8,
    "libelle": "Entretien structuré + étude de cas"
  },
  {
    "_id": "modalite_9",
    "categorie": "modalite_evaluation",
    "code_id": 9,
    "libelle": "Auto-évaluation guidée + consignes"
  },
  {
    "_id": "modalite_10",
    "categorie": "modalite_evaluation",
    "code_id": 10,
    "libelle": "Mise en situation + observation"
  },
  {
    "_id": "modalite_11",
    "categorie": "modalite_evaluation",
    "code_id": 11,
    "libelle": "Exercice outil + cas incident"
  },
  {
    "_id": "modalite_12",
    "categorie": "modalite_evaluation",
    "code_id": 12,
    "libelle": "Mise en situation + QCM procédure"
  },
  {
    "_id": "modalite_13",
    "categorie": "modalite_evaluation",
    "code_id": 13,
    "libelle": "Atelier + audit"
  },
  {
    "_id": "modalite_14",
    "categorie": "modalite_evaluation",
    "code_id": 14,
    "libelle": "Étude de cas + optimisation sur carte"
  },
  {
    "_id": "modalite_15",
    "categorie": "modalite_evaluation",
    "code_id": 15,
    "libelle": "Jeu de rôle + grille"
  },
  {
    "_id": "modalite_16",
    "categorie": "modalite_evaluation",
    "code_id": 16,
    "libelle": "Observation + module prévention"
  },
  {
    "_id": "modalite_17",
    "categorie": "modalite_evaluation",
    "code_id": 17,
    "libelle": "Simulation haute fidélité + QCM"
  },
  {
    "_id": "modalite_18",
    "categorie": "modalite_evaluation",
    "code_id": 18,
    "libelle": "Simulation conduite + observation"
  },
  {
    "_id": "modalite_19",
    "categorie": "modalite_evaluation",
    "code_id": 19,
    "libelle": "Jeu de rôle + entretien"
  },
  {
    "_id": "modalite_20",
    "categorie": "modalite_evaluation",
    "code_id": 20,
    "libelle": "Mise en situation"
  },
  {
    "_id": "modalite_21",
    "categorie": "modalite_evaluation",
    "code_id": 21,
    "libelle": "Simulation + étude de cas"
  },
  {
    "_id": "modalite_22",
    "categorie": "modalite_evaluation",
    "code_id": 22,
    "libelle": "QCM + mise en situation encadrée"
  },
  {
    "_id": "modalite_23",
    "categorie": "modalite_evaluation",
    "code_id": 23,
    "libelle": "Étude de cas + TP"
  },
  {
    "_id": "modalite_24",
    "categorie": "modalite_evaluation",
    "code_id": 24,
    "libelle": "Étude de cas"
  },
  {
    "_id": "modalite_25",
    "categorie": "modalite_evaluation",
    "code_id": 25,
    "libelle": "Entretien + mises en situation"
  },
  {
    "_id": "modalite_26",
    "categorie": "modalite_evaluation",
    "code_id": 26,
    "libelle": "Observation + entretien"
  },
  {
    "_id": "modalite_27",
    "categorie": "modalite_evaluation",
    "code_id": 27,
    "libelle": "Simulation/étude de cas"
  },
  {
    "_id": "modalite_28",
    "categorie": "modalite_evaluation",
    "code_id": 28,
    "libelle": "Entretien + observation"
  },
  {
    "_id": "modalite_29",
    "categorie": "modalite_evaluation",
    "code_id": 29,
    "libelle": "Auto-évaluation + consignes"
  },
  {
    "_id": "modalite_30",
    "categorie": "modalite_evaluation",
    "code_id": 30,
    "libelle": "Mise en situation + audit"
  },
  {
    "_id": "modalite_31",
    "categorie": "modalite_evaluation",
    "code_id": 31,
    "libelle": "Exercice tri + QCM"
  },
  {
    "_id": "modalite_32",
    "categorie": "modalite_evaluation",
    "code_id": 32,
    "libelle": "Simulation flux"
  },
  {
    "_id": "modalite_33",
    "categorie": "modalite_evaluation",
    "code_id": 33,
    "libelle": "Audit sécurité"
  },
  {
    "_id": "modalite_34",
    "categorie": "modalite_evaluation",
    "code_id": 34,
    "libelle": "Observation + jeu de rôle"
  },
  {
    "_id": "modalite_35",
    "categorie": "modalite_evaluation",
    "code_id": 35,
    "libelle": "Observation"
  },
  {
    "_id": "modalite_36",
    "categorie": "modalite_evaluation",
    "code_id": 36,
    "libelle": "Exercice WMS + cas"
  },
  {
    "_id": "modalite_37",
    "categorie": "modalite_evaluation",
    "code_id": 37,
    "libelle": "Étude de cas + optimisation"
  },
  {
    "_id": "modalite_38",
    "categorie": "modalite_evaluation",
    "code_id": 38,
    "libelle": "Audit + QCM"
  },
  {
    "_id": "modalite_39",
    "categorie": "modalite_evaluation",
    "code_id": 39,
    "libelle": "Auto-évaluation + observation"
  },
  {
    "_id": "modalite_40",
    "categorie": "modalite_evaluation",
    "code_id": 40,
    "libelle": "Simulation + chrono"
  },
  {
    "_id": "modalite_41",
    "categorie": "modalite_evaluation",
    "code_id": 41,
    "libelle": "Audit + cas"
  },
  {
    "_id": "modalite_42",
    "categorie": "modalite_evaluation",
    "code_id": 42,
    "libelle": "Entretien + cas"
  },
  {
    "_id": "modalite_43",
    "categorie": "modalite_evaluation",
    "code_id": 43,
    "libelle": "Atelier"
  },
  {
    "_id": "modalite_44",
    "categorie": "modalite_evaluation",
    "code_id": 44,
    "libelle": "Jeu de rôle"
  },
  {
    "_id": "modalite_45",
    "categorie": "modalite_evaluation",
    "code_id": 45,
    "libelle": "TP atelier + étude de cas"
  },
  {
    "_id": "modalite_46",
    "categorie": "modalite_evaluation",
    "code_id": 46,
    "libelle": "TP"
  },
  {
    "_id": "modalite_47",
    "categorie": "modalite_evaluation",
    "code_id": 47,
    "libelle": "Cas + exercice"
  },
  {
    "_id": "modalite_48",
    "categorie": "modalite_evaluation",
    "code_id": 48,
    "libelle": "Étude de cas + projet"
  },
  {
    "_id": "modalite_49",
    "categorie": "modalite_evaluation",
    "code_id": 49,
    "libelle": "Étude de cas + négociation"
  },
  {
    "_id": "modalite_50",
    "categorie": "modalite_evaluation",
    "code_id": 50,
    "libelle": "Projet Excel/BI"
  },
  {
    "_id": "modalite_51",
    "categorie": "modalite_evaluation",
    "code_id": 51,
    "libelle": "Étude de cas + QCM"
  },
  {
    "_id": "modalite_52",
    "categorie": "modalite_evaluation",
    "code_id": 52,
    "libelle": "TP outil + cas"
  },
  {
    "_id": "modalite_53",
    "categorie": "modalite_evaluation",
    "code_id": 53,
    "libelle": "Étude de cas chiffrée"
  },
  {
    "_id": "modalite_54",
    "categorie": "modalite_evaluation",
    "code_id": 54,
    "libelle": "Simulation crise"
  },
  {
    "_id": "modalite_55",
    "categorie": "modalite_evaluation",
    "code_id": 55,
    "libelle": "Jeu de rôle + cas"
  },
  {
    "_id": "modalite_56",
    "categorie": "modalite_evaluation",
    "code_id": 56,
    "libelle": "Entretien + simulation"
  },
  {
    "_id": "modalite_57",
    "categorie": "modalite_evaluation",
    "code_id": 57,
    "libelle": "Entretien"
  },
  {
    "_id": "modalite_58",
    "categorie": "modalite_evaluation",
    "code_id": 58,
    "libelle": "Étude de cas + simulation"
  },
  {
    "_id": "modalite_59",
    "categorie": "modalite_evaluation",
    "code_id": 59,
    "libelle": "QCM + cas"
  },
  {
    "_id": "modalite_60",
    "categorie": "modalite_evaluation",
    "code_id": 60,
    "libelle": "Projet"
  },
  {
    "_id": "modalite_61",
    "categorie": "modalite_evaluation",
    "code_id": 61,
    "libelle": "Auto-évaluation"
  },
  {
    "_id": "modalite_62",
    "categorie": "modalite_evaluation",
    "code_id": 62,
    "libelle": "Projet data + soutenance"
  },
  {
    "_id": "modalite_63",
    "categorie": "modalite_evaluation",
    "code_id": 63,
    "libelle": "TP Excel"
  },
  {
    "_id": "modalite_64",
    "categorie": "modalite_evaluation",
    "code_id": 64,
    "libelle": "TP outil / cas"
  },
  {
    "_id": "modalite_65",
    "categorie": "modalite_evaluation",
    "code_id": 65,
    "libelle": "Jeu de rôle S&OP"
  },
  {
    "_id": "modalite_66",
    "categorie": "modalite_evaluation",
    "code_id": 66,
    "libelle": "Oral + dossier"
  },
  {
    "_id": "modalite_67",
    "categorie": "modalite_evaluation",
    "code_id": 67,
    "libelle": "TP WMS"
  },
  {
    "_id": "modalite_68",
    "categorie": "modalite_evaluation",
    "code_id": 68,
    "libelle": "Projet implantation"
  },
  {
    "_id": "modalite_69",
    "categorie": "modalite_evaluation",
    "code_id": 69,
    "libelle": "Cas chiffré"
  },
  {
    "_id": "modalite_70",
    "categorie": "modalite_evaluation",
    "code_id": 70,
    "libelle": "TP procédure + cas"
  },
  {
    "_id": "modalite_71",
    "categorie": "modalite_evaluation",
    "code_id": 71,
    "libelle": "Projet simulation"
  },
  {
    "_id": "modalite_72",
    "categorie": "modalite_evaluation",
    "code_id": 72,
    "libelle": "Projet + soutenance"
  },
  {
    "_id": "modalite_73",
    "categorie": "modalite_evaluation",
    "code_id": 73,
    "libelle": "TP CRM"
  },
  {
    "_id": "modalite_74",
    "categorie": "modalite_evaluation",
    "code_id": 74,
    "libelle": "Oral + écrit"
  },
  {
    "_id": "modalite_75",
    "categorie": "modalite_evaluation",
    "code_id": 75,
    "libelle": "Simulation"
  },
  {
    "_id": "modalite_76",
    "categorie": "modalite_evaluation",
    "code_id": 76,
    "libelle": "Projet data"
  },
  {
    "_id": "modalite_77",
    "categorie": "modalite_evaluation",
    "code_id": 77,
    "libelle": "Jeu de rôle comité"
  },
  {
    "_id": "modalite_78",
    "categorie": "modalite_evaluation",
    "code_id": 78,
    "libelle": "Soutenance + entretien"
  },
  {
    "_id": "modalite_79",
    "categorie": "modalite_evaluation",
    "code_id": 79,
    "libelle": "Entretien + mise en situation"
  },
  {
    "_id": "formation_1",
    "categorie": "formation_activite",
    "code_id": 1,
    "libelle": "TP simulateur + analyse données"
  },
  {
    "_id": "formation_2",
    "categorie": "formation_activite",
    "code_id": 2,
    "libelle": "TP contrôle départ"
  },
  {
    "_id": "formation_3",
    "categorie": "formation_activite",
    "code_id": 3,
    "libelle": "TP arrimage + RETEX"
  },
  {
    "_id": "formation_4",
    "categorie": "formation_activite",
    "code_id": 4,
    "libelle": "TD documentation transport"
  },
  {
    "_id": "formation_5",
    "categorie": "formation_activite",
    "code_id": 5,
    "libelle": "TD réglementation + simulation tournée"
  },
  {
    "_id": "formation_6",
    "categorie": "formation_activite",
    "code_id": 6,
    "libelle": "Cas pratiques itinéraires"
  },
  {
    "_id": "formation_7",
    "categorie": "formation_activite",
    "code_id": 7,
    "libelle": "Jeux de rôle + débrief"
  },
  {
    "_id": "formation_8",
    "categorie": "formation_activite",
    "code_id": 8,
    "libelle": "Atelier facteurs humains"
  },
  {
    "_id": "formation_9",
    "categorie": "formation_activite",
    "code_id": 9,
    "libelle": "Module prévention TMS"
  },
  {
    "_id": "formation_10",
    "categorie": "formation_activite",
    "code_id": 10,
    "libelle": "TP conduite urbaine"
  },
  {
    "_id": "formation_11",
    "categorie": "formation_activite",
    "code_id": 11,
    "libelle": "TP SI logistique"
  },
  {
    "_id": "formation_12",
    "categorie": "formation_activite",
    "code_id": 12,
    "libelle": "Cas pratiques encaissement"
  },
  {
    "_id": "formation_13",
    "categorie": "formation_activite",
    "code_id": 13,
    "libelle": "TP chargement"
  },
  {
    "_id": "formation_14",
    "categorie": "formation_activite",
    "code_id": 14,
    "libelle": "TD optimisation tournée"
  },
  {
    "_id": "formation_15",
    "categorie": "formation_activite",
    "code_id": 15,
    "libelle": "Jeu de rôle"
  },
  {
    "_id": "formation_16",
    "categorie": "formation_activite",
    "code_id": 16,
    "libelle": "TP gestes & postures"
  },
  {
    "_id": "formation_17",
    "categorie": "formation_activite",
    "code_id": 17,
    "libelle": "TP simulation"
  }
]
);

db.vocabulaire.insertMany(
[
  {
    "_id": "formation_18",
    "categorie": "formation_activite",
    "code_id": 18,
    "libelle": "TP conduite"
  },
  {
    "_id": "formation_19",
    "categorie": "formation_activite",
    "code_id": 19,
    "libelle": "TP préparation"
  },
  {
    "_id": "formation_20",
    "categorie": "formation_activite",
    "code_id": 20,
    "libelle": "Simulations"
  },
  {
    "_id": "formation_21",
    "categorie": "formation_activite",
    "code_id": 21,
    "libelle": "TP brancardage"
  },
  {
    "_id": "formation_22",
    "categorie": "formation_activite",
    "code_id": 22,
    "libelle": "Cas sûreté"
  },
  {
    "_id": "formation_23",
    "categorie": "formation_activite",
    "code_id": 23,
    "libelle": "Module sûreté"
  },
  {
    "_id": "formation_24",
    "categorie": "formation_activite",
    "code_id": 24,
    "libelle": "TP maintenance"
  },
  {
    "_id": "formation_25",
    "categorie": "formation_activite",
    "code_id": 25,
    "libelle": "TD"
  },
  {
    "_id": "formation_26",
    "categorie": "formation_activite",
    "code_id": 26,
    "libelle": "Cas éthiques"
  },
  {
    "_id": "formation_27",
    "categorie": "formation_activite",
    "code_id": 27,
    "libelle": "TP"
  },
  {
    "_id": "formation_28",
    "categorie": "formation_activite",
    "code_id": 28,
    "libelle": "Atelier"
  },
  {
    "_id": "formation_29",
    "categorie": "formation_activite",
    "code_id": 29,
    "libelle": "Module"
  },
  {
    "_id": "formation_30",
    "categorie": "formation_activite",
    "code_id": 30,
    "libelle": "Serious game"
  },
  {
    "_id": "formation_31",
    "categorie": "formation_activite",
    "code_id": 31,
    "libelle": "Visite sécurité"
  },
  {
    "_id": "formation_32",
    "categorie": "formation_activite",
    "code_id": 32,
    "libelle": "Exercice"
  },
  {
    "_id": "formation_33",
    "categorie": "formation_activite",
    "code_id": 33,
    "libelle": "TP SI"
  },
  {
    "_id": "formation_34",
    "categorie": "formation_activite",
    "code_id": 34,
    "libelle": "Projet"
  },
  {
    "_id": "formation_35",
    "categorie": "formation_activite",
    "code_id": 35,
    "libelle": "Cas"
  },
  {
    "_id": "formation_36",
    "categorie": "formation_activite",
    "code_id": 36,
    "libelle": "Projet data"
  },
  {
    "_id": "formation_37",
    "categorie": "formation_activite",
    "code_id": 37,
    "libelle": "Oral"
  },
  {
    "_id": "formation_38",
    "categorie": "formation_activite",
    "code_id": 38,
    "libelle": "Visite"
  },
  {
    "_id": "formation_39",
    "categorie": "formation_activite",
    "code_id": 39,
    "libelle": "Projet veille"
  },
  {
    "_id": "formation_40",
    "categorie": "formation_activite",
    "code_id": 40,
    "libelle": "Simulation"
  },
  {
    "_id": "outil_1",
    "categorie": "outil",
    "code_id": 1,
    "libelle": "Aides manutention"
  },
  {
    "_id": "outil_2",
    "categorie": "outil",
    "code_id": 2,
    "libelle": "Ambulance"
  },
  {
    "_id": "outil_3",
    "categorie": "outil",
    "code_id": 3,
    "libelle": "Appli e-CMR"
  },
  {
    "_id": "outil_4",
    "categorie": "outil",
    "code_id": 4,
    "libelle": "BI"
  },
  {
    "_id": "outil_5",
    "categorie": "outil",
    "code_id": 5,
    "libelle": "BI/ERP"
  },
  {
    "_id": "outil_6",
    "categorie": "outil",
    "code_id": 6,
    "libelle": "BI/Excel"
  },
  {
    "_id": "outil_7",
    "categorie": "outil",
    "code_id": 7,
    "libelle": "Bases douanières"
  },
  {
    "_id": "outil_8",
    "categorie": "outil",
    "code_id": 8,
    "libelle": "Bateau/Simu"
  },
  {
    "_id": "outil_9",
    "categorie": "outil",
    "code_id": 9,
    "libelle": "Bourse de fret"
  },
  {
    "_id": "outil_10",
    "categorie": "outil",
    "code_id": 10,
    "libelle": "Brancard"
  },
  {
    "_id": "outil_11",
    "categorie": "outil",
    "code_id": 11,
    "libelle": "CRM"
  },
  {
    "_id": "outil_12",
    "categorie": "outil",
    "code_id": 12,
    "libelle": "CRM/Excel"
  },
  {
    "_id": "outil_13",
    "categorie": "outil",
    "code_id": 13,
    "libelle": "Cartes"
  },
  {
    "_id": "outil_14",
    "categorie": "outil",
    "code_id": 14,
    "libelle": "Cartons"
  },
  {
    "_id": "outil_15",
    "categorie": "outil",
    "code_id": 15,
    "libelle": "Casque voice"
  },
  {
    "_id": "outil_16",
    "categorie": "outil",
    "code_id": 16,
    "libelle": "Chariot"
  },
  {
    "_id": "outil_17",
    "categorie": "outil",
    "code_id": 17,
    "libelle": "Chariot m"
  },
  {
    "_id": "outil_18",
    "categorie": "outil",
    "code_id": 18,
    "libelle": "Chaussures"
  },
  {
    "_id": "outil_19",
    "categorie": "outil",
    "code_id": 19,
    "libelle": "Check-lists"
  },
  {
    "_id": "outil_20",
    "categorie": "outil",
    "code_id": 20,
    "libelle": "Chronotachygraphe"
  },
  {
    "_id": "outil_21",
    "categorie": "outil",
    "code_id": 21,
    "libelle": "Diable"
  },
  {
    "_id": "outil_22",
    "categorie": "outil",
    "code_id": 22,
    "libelle": "Docs achats"
  },
  {
    "_id": "outil_23",
    "categorie": "outil",
    "code_id": 23,
    "libelle": "Docs sécurité"
  },
  {
    "_id": "outil_24",
    "categorie": "outil",
    "code_id": 24,
    "libelle": "EPI"
  },
  {
    "_id": "outil_25",
    "categorie": "outil",
    "code_id": 25,
    "libelle": "ERP"
  },
  {
    "_id": "outil_26",
    "categorie": "outil",
    "code_id": 26,
    "libelle": "ERP/GMAO"
  },
  {
    "_id": "outil_27",
    "categorie": "outil",
    "code_id": 27,
    "libelle": "ERP/WMS"
  },
  {
    "_id": "outil_28",
    "categorie": "outil",
    "code_id": 28,
    "libelle": "Email/téléphone"
  },
  {
    "_id": "outil_29",
    "categorie": "outil",
    "code_id": 29,
    "libelle": "Excel"
  },
  {
    "_id": "outil_30",
    "categorie": "outil",
    "code_id": 30,
    "libelle": "Excel/BI"
  },
  {
    "_id": "outil_31",
    "categorie": "outil",
    "code_id": 31,
    "libelle": "Excel/Python/R"
  },
  {
    "_id": "outil_32",
    "categorie": "outil",
    "code_id": 32,
    "libelle": "Excel/VBA"
  },
  {
    "_id": "outil_33",
    "categorie": "outil",
    "code_id": 33,
    "libelle": "Excel/WMS"
  },
  {
    "_id": "outil_34",
    "categorie": "outil",
    "code_id": 34,
    "libelle": "Filmeuse"
  },
  {
    "_id": "outil_35",
    "categorie": "outil",
    "code_id": 35,
    "libelle": "GMAO"
  },
  {
    "_id": "outil_36",
    "categorie": "outil",
    "code_id": 36,
    "libelle": "GPS pro"
  },
  {
    "_id": "outil_37",
    "categorie": "outil",
    "code_id": 37,
    "libelle": "KPI"
  },
  {
    "_id": "outil_38",
    "categorie": "outil",
    "code_id": 38,
    "libelle": "Kit médical"
  },
  {
    "_id": "outil_39",
    "categorie": "outil",
    "code_id": 39,
    "libelle": "Logiciel tournée"
  },
  {
    "_id": "outil_40",
    "categorie": "outil",
    "code_id": 40,
    "libelle": "MS Project/Excel"
  },
  {
    "_id": "outil_41",
    "categorie": "outil",
    "code_id": 41,
    "libelle": "Matériel emballage"
  },
  {
    "_id": "outil_42",
    "categorie": "outil",
    "code_id": 42,
    "libelle": "Matériel médical"
  },
  {
    "_id": "outil_43",
    "categorie": "outil",
    "code_id": 43,
    "libelle": "Outil flotte"
  },
  {
    "_id": "outil_44",
    "categorie": "outil",
    "code_id": 44,
    "libelle": "Outil flotte/Excel"
  },
  {
    "_id": "outil_45",
    "categorie": "outil",
    "code_id": 45,
    "libelle": "Outil simulation/Excel"
  },
  {
    "_id": "outil_46",
    "categorie": "outil",
    "code_id": 46,
    "libelle": "Outil tournée"
  },
  {
    "_id": "outil_47",
    "categorie": "outil",
    "code_id": 47,
    "libelle": "Outillage"
  },
  {
    "_id": "outil_48",
    "categorie": "outil",
    "code_id": 48,
    "libelle": "Outils"
  },
  {
    "_id": "outil_49",
    "categorie": "outil",
    "code_id": 49,
    "libelle": "Outils DAO/Excel"
  },
  {
    "_id": "outil_50",
    "categorie": "outil",
    "code_id": 50,
    "libelle": "Outils DUERP"
  },
  {
    "_id": "outil_51",
    "categorie": "outil",
    "code_id": 51,
    "libelle": "Outils Lean"
  },
  {
    "_id": "outil_52",
    "categorie": "outil",
    "code_id": 52,
    "libelle": "Outils QSE"
  },
  {
    "_id": "outil_53",
    "categorie": "outil",
    "code_id": 53,
    "libelle": "Outils RH"
  },
  {
    "_id": "outil_54",
    "categorie": "outil",
    "code_id": 54,
    "libelle": "Outils bureautiques"
  },
  {
    "_id": "outil_55",
    "categorie": "outil",
    "code_id": 55,
    "libelle": "Outils de maintenance"
  },
  {
    "_id": "outil_56",
    "categorie": "outil",
    "code_id": 56,
    "libelle": "Outils déclaratifs"
  },
  {
    "_id": "outil_57",
    "categorie": "outil",
    "code_id": 57,
    "libelle": "Outils management"
  },
  {
    "_id": "outil_58",
    "categorie": "outil",
    "code_id": 58,
    "libelle": "Outils mapping"
  },
  {
    "_id": "outil_59",
    "categorie": "outil",
    "code_id": 59,
    "libelle": "Outils planning"
  },
  {
    "_id": "outil_60",
    "categorie": "outil",
    "code_id": 60,
    "libelle": "Outils portuaires"
  },
  {
    "_id": "outil_61",
    "categorie": "outil",
    "code_id": 61,
    "libelle": "Outils terrain"
  },
  {
    "_id": "outil_62",
    "categorie": "outil",
    "code_id": 62,
    "libelle": "PDA"
  },
  {
    "_id": "outil_63",
    "categorie": "outil",
    "code_id": 63,
    "libelle": "Plan"
  },
  {
    "_id": "outil_64",
    "categorie": "outil",
    "code_id": 64,
    "libelle": "Radio/messagerie"
  },
  {
    "_id": "outil_65",
    "categorie": "outil",
    "code_id": 65,
    "libelle": "Radio/téléphone"
  },
  {
    "_id": "outil_66",
    "categorie": "outil",
    "code_id": 66,
    "libelle": "Sangles"
  },
  {
    "_id": "outil_67",
    "categorie": "outil",
    "code_id": 67,
    "libelle": "Scanner"
  },
  {
    "_id": "outil_68",
    "categorie": "outil",
    "code_id": 68,
    "libelle": "TMS"
  },
  {
    "_id": "outil_69",
    "categorie": "outil",
    "code_id": 69,
    "libelle": "TMS/SAEIV"
  },
  {
    "_id": "outil_70",
    "categorie": "outil",
    "code_id": 70,
    "libelle": "TPE"
  },
  {
    "_id": "outil_71",
    "categorie": "outil",
    "code_id": 71,
    "libelle": "Tableaux"
  },
  {
    "_id": "outil_72",
    "categorie": "outil",
    "code_id": 72,
    "libelle": "Talkie-walkie"
  },
  {
    "_id": "outil_73",
    "categorie": "outil",
    "code_id": 73,
    "libelle": "Transpalette"
  },
  {
    "_id": "outil_74",
    "categorie": "outil",
    "code_id": 74,
    "libelle": "Télématique"
  },
  {
    "_id": "outil_75",
    "categorie": "outil",
    "code_id": 75,
    "libelle": "Téléphone"
  },
  {
    "_id": "outil_76",
    "categorie": "outil",
    "code_id": 76,
    "libelle": "VUL"
  },
  {
    "_id": "outil_77",
    "categorie": "outil",
    "code_id": 77,
    "libelle": "Valise diag"
  }
]
);

db.vocabulaire.insertMany(
[
  {
    "_id": "outil_78",
    "categorie": "outil",
    "code_id": 78,
    "libelle": "Véhicule"
  },
  {
    "_id": "outil_79",
    "categorie": "outil",
    "code_id": 79,
    "libelle": "Véhicule blindé"
  },
  {
    "_id": "outil_80",
    "categorie": "outil",
    "code_id": 80,
    "libelle": "WMS"
  },
  {
    "_id": "outil_81",
    "categorie": "outil",
    "code_id": 81,
    "libelle": "WMS/Excel"
  },
  {
    "_id": "outil_82",
    "categorie": "outil",
    "code_id": 82,
    "libelle": "WMS/tri"
  },
  {
    "_id": "outil_83",
    "categorie": "outil",
    "code_id": 83,
    "libelle": "appli encaissement"
  },
  {
    "_id": "outil_84",
    "categorie": "outil",
    "code_id": 84,
    "libelle": "barres"
  },
  {
    "_id": "outil_85",
    "categorie": "outil",
    "code_id": 85,
    "libelle": "cales"
  },
  {
    "_id": "outil_86",
    "categorie": "outil",
    "code_id": 86,
    "libelle": "carto"
  },
  {
    "_id": "outil_87",
    "categorie": "outil",
    "code_id": 87,
    "libelle": "chaise"
  },
  {
    "_id": "outil_88",
    "categorie": "outil",
    "code_id": 88,
    "libelle": "check-list"
  },
  {
    "_id": "outil_89",
    "categorie": "outil",
    "code_id": 89,
    "libelle": "couvertures"
  },
  {
    "_id": "outil_90",
    "categorie": "outil",
    "code_id": 90,
    "libelle": "diable"
  },
  {
    "_id": "outil_91",
    "categorie": "outil",
    "code_id": 91,
    "libelle": "messagerie"
  },
  {
    "_id": "outil_92",
    "categorie": "outil",
    "code_id": 92,
    "libelle": "moteur"
  },
  {
    "_id": "outil_93",
    "categorie": "outil",
    "code_id": 93,
    "libelle": "ordinateur de bord"
  },
  {
    "_id": "outil_94",
    "categorie": "outil",
    "code_id": 94,
    "libelle": "planning"
  },
  {
    "_id": "outil_95",
    "categorie": "outil",
    "code_id": 95,
    "libelle": "sangles"
  },
  {
    "_id": "outil_96",
    "categorie": "outil",
    "code_id": 96,
    "libelle": "scanner"
  },
  {
    "_id": "outil_97",
    "categorie": "outil",
    "code_id": 97,
    "libelle": "tapis"
  },
  {
    "_id": "outil_98",
    "categorie": "outil",
    "code_id": 98,
    "libelle": "transpalette"
  },
  {
    "_id": "outil_99",
    "categorie": "outil",
    "code_id": 99,
    "libelle": "téléphone"
  },
  {
    "_id": "outil_100",
    "categorie": "outil",
    "code_id": 100,
    "libelle": "Équipements sûreté"
  },
  {
    "_id": "norme_1",
    "categorie": "reglementation_norme",
    "code_id": 1,
    "libelle": "5S/Lean (bases)"
  },
  {
    "_id": "norme_2",
    "categorie": "reglementation_norme",
    "code_id": 2,
    "libelle": "AFGSU"
  },
  {
    "_id": "norme_3",
    "categorie": "reglementation_norme",
    "code_id": 3,
    "libelle": "Autorités portuaires"
  },
  {
    "_id": "norme_4",
    "categorie": "reglementation_norme",
    "code_id": 4,
    "libelle": "Bonnes pratiques arrimage"
  },
  {
    "_id": "norme_5",
    "categorie": "reglementation_norme",
    "code_id": 5,
    "libelle": "CDU"
  },
  {
    "_id": "norme_6",
    "categorie": "reglementation_norme",
    "code_id": 6,
    "libelle": "Cadre social"
  },
  {
    "_id": "norme_7",
    "categorie": "reglementation_norme",
    "code_id": 7,
    "libelle": "Charte relation client"
  },
  {
    "_id": "norme_8",
    "categorie": "reglementation_norme",
    "code_id": 8,
    "libelle": "Charte service"
  },
  {
    "_id": "norme_9",
    "categorie": "reglementation_norme",
    "code_id": 9,
    "libelle": "Code route"
  },
  {
    "_id": "norme_10",
    "categorie": "reglementation_norme",
    "code_id": 10,
    "libelle": "Code route + règles locales"
  },
  {
    "_id": "norme_11",
    "categorie": "reglementation_norme",
    "code_id": 11,
    "libelle": "Code route + règles urgence"
  },
  {
    "_id": "norme_12",
    "categorie": "reglementation_norme",
    "code_id": 12,
    "libelle": "Consignes sécurité"
  },
  {
    "_id": "norme_13",
    "categorie": "reglementation_norme",
    "code_id": 13,
    "libelle": "Contraintes SLA"
  },
  {
    "_id": "norme_14",
    "categorie": "reglementation_norme",
    "code_id": 14,
    "libelle": "Contrôle de gestion"
  },
  {
    "_id": "norme_15",
    "categorie": "reglementation_norme",
    "code_id": 15,
    "libelle": "Contrôle de gestion (bases)"
  },
  {
    "_id": "norme_16",
    "categorie": "reglementation_norme",
    "code_id": 16,
    "libelle": "Convention CMR"
  },
  {
    "_id": "norme_17",
    "categorie": "reglementation_norme",
    "code_id": 17,
    "libelle": "Culture sécurité"
  },
  {
    "_id": "norme_18",
    "categorie": "reglementation_norme",
    "code_id": 18,
    "libelle": "DELTA/OEA"
  },
  {
    "_id": "norme_19",
    "categorie": "reglementation_norme",
    "code_id": 19,
    "libelle": "DUERP"
  },
  {
    "_id": "norme_20",
    "categorie": "reglementation_norme",
    "code_id": 20,
    "libelle": "Droit commercial (bases)"
  },
  {
    "_id": "norme_21",
    "categorie": "reglementation_norme",
    "code_id": 21,
    "libelle": "Droit du travail"
  },
  {
    "_id": "norme_22",
    "categorie": "reglementation_norme",
    "code_id": 22,
    "libelle": "Droit du travail (bases)"
  },
  {
    "_id": "norme_23",
    "categorie": "reglementation_norme",
    "code_id": 23,
    "libelle": "Déontologie"
  },
  {
    "_id": "norme_24",
    "categorie": "reglementation_norme",
    "code_id": 24,
    "libelle": "Ergonomie"
  },
  {
    "_id": "norme_25",
    "categorie": "reglementation_norme",
    "code_id": 25,
    "libelle": "FIFO/ABC"
  },
  {
    "_id": "norme_26",
    "categorie": "reglementation_norme",
    "code_id": 26,
    "libelle": "Finance (bases)"
  },
  {
    "_id": "norme_27",
    "categorie": "reglementation_norme",
    "code_id": 27,
    "libelle": "Gestion budgétaire"
  },
  {
    "_id": "norme_28",
    "categorie": "reglementation_norme",
    "code_id": 28,
    "libelle": "Gestion de projet"
  },
  {
    "_id": "norme_29",
    "categorie": "reglementation_norme",
    "code_id": 29,
    "libelle": "Gouvernance S&OP"
  },
  {
    "_id": "norme_30",
    "categorie": "reglementation_norme",
    "code_id": 30,
    "libelle": "ICPE (sensibilisation)"
  },
  {
    "_id": "norme_31",
    "categorie": "reglementation_norme",
    "code_id": 31,
    "libelle": "ISO"
  },
  {
    "_id": "norme_32",
    "categorie": "reglementation_norme",
    "code_id": 32,
    "libelle": "Incoterms"
  },
  {
    "_id": "norme_33",
    "categorie": "reglementation_norme",
    "code_id": 33,
    "libelle": "Incoterms (bases)"
  },
  {
    "_id": "norme_34",
    "categorie": "reglementation_norme",
    "code_id": 34,
    "libelle": "Lean"
  },
  {
    "_id": "norme_35",
    "categorie": "reglementation_norme",
    "code_id": 35,
    "libelle": "Lean (bases)"
  },
  {
    "_id": "norme_36",
    "categorie": "reglementation_norme",
    "code_id": 36,
    "libelle": "Normes constructeur"
  },
  {
    "_id": "norme_37",
    "categorie": "reglementation_norme",
    "code_id": 37,
    "libelle": "OEA"
  },
  {
    "_id": "norme_38",
    "categorie": "reglementation_norme",
    "code_id": 38,
    "libelle": "Procédure interne"
  },
  {
    "_id": "norme_39",
    "categorie": "reglementation_norme",
    "code_id": 39,
    "libelle": "Procédures"
  },
  {
    "_id": "norme_40",
    "categorie": "reglementation_norme",
    "code_id": 40,
    "libelle": "Procédures ONG (sensibilisation)"
  },
  {
    "_id": "norme_41",
    "categorie": "reglementation_norme",
    "code_id": 41,
    "libelle": "Procédures WMS"
  },
  {
    "_id": "norme_42",
    "categorie": "reglementation_norme",
    "code_id": 42,
    "libelle": "Procédures achats"
  },
  {
    "_id": "norme_43",
    "categorie": "reglementation_norme",
    "code_id": 43,
    "libelle": "Procédures atelier"
  },
  {
    "_id": "norme_44",
    "categorie": "reglementation_norme",
    "code_id": 44,
    "libelle": "Procédures entreprise"
  },
  {
    "_id": "norme_45",
    "categorie": "reglementation_norme",
    "code_id": 45,
    "libelle": "Procédures hygiène"
  },
  {
    "_id": "norme_46",
    "categorie": "reglementation_norme",
    "code_id": 46,
    "libelle": "Procédures internes"
  },
  {
    "_id": "norme_47",
    "categorie": "reglementation_norme",
    "code_id": 47,
    "libelle": "Procédures inventaire"
  },
  {
    "_id": "norme_48",
    "categorie": "reglementation_norme",
    "code_id": 48,
    "libelle": "Procédures maintenance"
  },
  {
    "_id": "norme_49",
    "categorie": "reglementation_norme",
    "code_id": 49,
    "libelle": "Procédures qualité"
  },
  {
    "_id": "norme_50",
    "categorie": "reglementation_norme",
    "code_id": 50,
    "libelle": "Procédures sécurité"
  },
  {
    "_id": "norme_51",
    "categorie": "reglementation_norme",
    "code_id": 51,
    "libelle": "Procédures sûreté"
  },
  {
    "_id": "norme_52",
    "categorie": "reglementation_norme",
    "code_id": 52,
    "libelle": "Procédures traçabilité"
  },
  {
    "_id": "norme_53",
    "categorie": "reglementation_norme",
    "code_id": 53,
    "libelle": "Protocoles SAMU"
  },
  {
    "_id": "norme_54",
    "categorie": "reglementation_norme",
    "code_id": 54,
    "libelle": "Prévention RPS"
  },
  {
    "_id": "norme_55",
    "categorie": "reglementation_norme",
    "code_id": 55,
    "libelle": "Prévention TMS"
  },
  {
    "_id": "norme_56",
    "categorie": "reglementation_norme",
    "code_id": 56,
    "libelle": "Prévention fatigue"
  },
  {
    "_id": "norme_57",
    "categorie": "reglementation_norme",
    "code_id": 57,
    "libelle": "Prévention risques"
  },
  {
    "_id": "norme_58",
    "categorie": "reglementation_norme",
    "code_id": 58,
    "libelle": "Prévention risques routiers"
  },
  {
    "_id": "norme_59",
    "categorie": "reglementation_norme",
    "code_id": 59,
    "libelle": "Prévention santé"
  },
  {
    "_id": "norme_60",
    "categorie": "reglementation_norme",
    "code_id": 60,
    "libelle": "Qualité"
  },
  {
    "_id": "norme_61",
    "categorie": "reglementation_norme",
    "code_id": 61,
    "libelle": "RSE"
  },
  {
    "_id": "norme_62",
    "categorie": "reglementation_norme",
    "code_id": 62,
    "libelle": "Règlement navigation"
  },
  {
    "_id": "norme_63",
    "categorie": "reglementation_norme",
    "code_id": 63,
    "libelle": "Règles navigation"
  },
  {
    "_id": "norme_64",
    "categorie": "reglementation_norme",
    "code_id": 64,
    "libelle": "Règles portuaires"
  },
  {
    "_id": "norme_65",
    "categorie": "reglementation_norme",
    "code_id": 65,
    "libelle": "Règles quai"
  },
  {
    "_id": "norme_66",
    "categorie": "reglementation_norme",
    "code_id": 66,
    "libelle": "Règles sécurité"
  },
  {
    "_id": "norme_67",
    "categorie": "reglementation_norme",
    "code_id": 67,
    "libelle": "Règles sécurité site"
  },
  {
    "_id": "norme_68",
    "categorie": "reglementation_norme",
    "code_id": 68,
    "libelle": "Règles sûreté"
  },
  {
    "_id": "norme_69",
    "categorie": "reglementation_norme",
    "code_id": 69,
    "libelle": "Réglementation"
  },
  {
    "_id": "norme_70",
    "categorie": "reglementation_norme",
    "code_id": 70,
    "libelle": "Réglementations"
  },
  {
    "_id": "norme_71",
    "categorie": "reglementation_norme",
    "code_id": 71,
    "libelle": "S&OP"
  },
  {
    "_id": "norme_72",
    "categorie": "reglementation_norme",
    "code_id": 72,
    "libelle": "SLA"
  },
  {
    "_id": "norme_73",
    "categorie": "reglementation_norme",
    "code_id": 73,
    "libelle": "Secret professionnel"
  },
  {
    "_id": "norme_74",
    "categorie": "reglementation_norme",
    "code_id": 74,
    "libelle": "Standards humanitaires (sensibilisation)"
  },
  {
    "_id": "norme_75",
    "categorie": "reglementation_norme",
    "code_id": 75,
    "libelle": "Sécurité"
  },
  {
    "_id": "norme_76",
    "categorie": "reglementation_norme",
    "code_id": 76,
    "libelle": "Sécurité EPI"
  },
  {
    "_id": "norme_77",
    "categorie": "reglementation_norme",
    "code_id": 77,
    "libelle": "Sécurité au travail"
  }
]
);

db.vocabulaire.insertMany(
[
  {
    "_id": "norme_78",
    "categorie": "reglementation_norme",
    "code_id": 78,
    "libelle": "Sécurité entrepôt"
  },
  {
    "_id": "norme_79",
    "categorie": "reglementation_norme",
    "code_id": 79,
    "libelle": "Sécurité manutention"
  },
  {
    "_id": "norme_80",
    "categorie": "reglementation_norme",
    "code_id": 80,
    "libelle": "Sécurité routière"
  },
  {
    "_id": "norme_81",
    "categorie": "reglementation_norme",
    "code_id": 81,
    "libelle": "Sécurité site"
  },
  {
    "_id": "norme_82",
    "categorie": "reglementation_norme",
    "code_id": 82,
    "libelle": "TARIC (principes)"
  },
  {
    "_id": "norme_83",
    "categorie": "reglementation_norme",
    "code_id": 83,
    "libelle": "TMD/ADR (principes)"
  },
  {
    "_id": "norme_84",
    "categorie": "reglementation_norme",
    "code_id": 84,
    "libelle": "Traçabilité"
  },
  {
    "_id": "norme_85",
    "categorie": "reglementation_norme",
    "code_id": 85,
    "libelle": "Éthique"
  },
  {
    "_id": "motcle_1",
    "categorie": "mot_cle",
    "code_id": 1,
    "libelle": "5S"
  },
  {
    "_id": "motcle_2",
    "categorie": "mot_cle",
    "code_id": 2,
    "libelle": "ABC"
  },
  {
    "_id": "motcle_3",
    "categorie": "mot_cle",
    "code_id": 3,
    "libelle": "ADR"
  },
  {
    "_id": "motcle_4",
    "categorie": "mot_cle",
    "code_id": 4,
    "libelle": "AFGSU"
  },
  {
    "_id": "motcle_5",
    "categorie": "mot_cle",
    "code_id": 5,
    "libelle": "C15"
  },
  {
    "_id": "motcle_6",
    "categorie": "mot_cle",
    "code_id": 6,
    "libelle": "CACES"
  },
  {
    "_id": "motcle_7",
    "categorie": "mot_cle",
    "code_id": 7,
    "libelle": "CDC"
  },
  {
    "_id": "motcle_8",
    "categorie": "mot_cle",
    "code_id": 8,
    "libelle": "CDU"
  },
  {
    "_id": "motcle_9",
    "categorie": "mot_cle",
    "code_id": 9,
    "libelle": "CMR"
  },
  {
    "_id": "motcle_10",
    "categorie": "mot_cle",
    "code_id": 10,
    "libelle": "CRM"
  },
  {
    "_id": "motcle_11",
    "categorie": "mot_cle",
    "code_id": 11,
    "libelle": "CT"
  },
  {
    "_id": "motcle_12",
    "categorie": "mot_cle",
    "code_id": 12,
    "libelle": "DAB"
  },
  {
    "_id": "motcle_13",
    "categorie": "mot_cle",
    "code_id": 13,
    "libelle": "DELTA"
  },
  {
    "_id": "motcle_14",
    "categorie": "mot_cle",
    "code_id": 14,
    "libelle": "DUERP"
  },
  {
    "_id": "motcle_15",
    "categorie": "mot_cle",
    "code_id": 15,
    "libelle": "EPI"
  },
  {
    "_id": "motcle_16",
    "categorie": "mot_cle",
    "code_id": 16,
    "libelle": "ERP"
  },
  {
    "_id": "motcle_17",
    "categorie": "mot_cle",
    "code_id": 17,
    "libelle": "Excel"
  },
  {
    "_id": "motcle_18",
    "categorie": "mot_cle",
    "code_id": 18,
    "libelle": "FIFO"
  },
  {
    "_id": "motcle_19",
    "categorie": "mot_cle",
    "code_id": 19,
    "libelle": "GMAO"
  },
  {
    "_id": "motcle_20",
    "categorie": "mot_cle",
    "code_id": 20,
    "libelle": "ICPE"
  },
  {
    "_id": "motcle_21",
    "categorie": "mot_cle",
    "code_id": 21,
    "libelle": "IRP"
  },
  {
    "_id": "motcle_22",
    "categorie": "mot_cle",
    "code_id": 22,
    "libelle": "ISO"
  },
  {
    "_id": "motcle_23",
    "categorie": "mot_cle",
    "code_id": 23,
    "libelle": "KPI"
  },
  {
    "_id": "motcle_24",
    "categorie": "mot_cle",
    "code_id": 24,
    "libelle": "OEA"
  },
  {
    "_id": "motcle_25",
    "categorie": "mot_cle",
    "code_id": 25,
    "libelle": "P&L"
  },
  {
    "_id": "motcle_26",
    "categorie": "mot_cle",
    "code_id": 26,
    "libelle": "PDA"
  },
  {
    "_id": "motcle_27",
    "categorie": "mot_cle",
    "code_id": 27,
    "libelle": "POD"
  },
  {
    "_id": "motcle_28",
    "categorie": "mot_cle",
    "code_id": 28,
    "libelle": "RH"
  },
  {
    "_id": "motcle_29",
    "categorie": "mot_cle",
    "code_id": 29,
    "libelle": "ROI"
  },
  {
    "_id": "motcle_30",
    "categorie": "mot_cle",
    "code_id": 30,
    "libelle": "RSE"
  },
  {
    "_id": "motcle_31",
    "categorie": "mot_cle",
    "code_id": 31,
    "libelle": "S&OP"
  },
  {
    "_id": "motcle_32",
    "categorie": "mot_cle",
    "code_id": 32,
    "libelle": "SAP"
  },
  {
    "_id": "motcle_33",
    "categorie": "mot_cle",
    "code_id": 33,
    "libelle": "SH"
  },
  {
    "_id": "motcle_34",
    "categorie": "mot_cle",
    "code_id": 34,
    "libelle": "SI"
  },
  {
    "_id": "motcle_35",
    "categorie": "mot_cle",
    "code_id": 35,
    "libelle": "SLA"
  },
  {
    "_id": "motcle_36",
    "categorie": "mot_cle",
    "code_id": 36,
    "libelle": "TCO"
  },
  {
    "_id": "motcle_37",
    "categorie": "mot_cle",
    "code_id": 37,
    "libelle": "TMD"
  },
  {
    "_id": "motcle_38",
    "categorie": "mot_cle",
    "code_id": 38,
    "libelle": "TMS"
  },
  {
    "_id": "motcle_39",
    "categorie": "mot_cle",
    "code_id": 39,
    "libelle": "VBA"
  },
  {
    "_id": "motcle_40",
    "categorie": "mot_cle",
    "code_id": 40,
    "libelle": "WMS"
  },
  {
    "_id": "motcle_41",
    "categorie": "mot_cle",
    "code_id": 41,
    "libelle": "achats"
  },
  {
    "_id": "motcle_42",
    "categorie": "mot_cle",
    "code_id": 42,
    "libelle": "adaptabilité"
  },
  {
    "_id": "motcle_43",
    "categorie": "mot_cle",
    "code_id": 43,
    "libelle": "affrètement"
  },
  {
    "_id": "motcle_44",
    "categorie": "mot_cle",
    "code_id": 44,
    "libelle": "aléas"
  },
  {
    "_id": "motcle_45",
    "categorie": "mot_cle",
    "code_id": 45,
    "libelle": "analyse"
  },
  {
    "_id": "motcle_46",
    "categorie": "mot_cle",
    "code_id": 46,
    "libelle": "anglais"
  },
  {
    "_id": "motcle_47",
    "categorie": "mot_cle",
    "code_id": 47,
    "libelle": "animation"
  },
  {
    "_id": "motcle_48",
    "categorie": "mot_cle",
    "code_id": 48,
    "libelle": "anticipation"
  },
  {
    "_id": "motcle_49",
    "categorie": "mot_cle",
    "code_id": 49,
    "libelle": "appel d soutenance"
  },
  {
    "_id": "motcle_50",
    "categorie": "mot_cle",
    "code_id": 50,
    "libelle": "arrimage"
  },
  {
    "_id": "motcle_51",
    "categorie": "mot_cle",
    "code_id": 51,
    "libelle": "astreinte"
  },
  {
    "_id": "motcle_52",
    "categorie": "mot_cle",
    "code_id": 52,
    "libelle": "audit"
  },
  {
    "_id": "motcle_53",
    "categorie": "mot_cle",
    "code_id": 53,
    "libelle": "autonomie"
  },
  {
    "_id": "motcle_54",
    "categorie": "mot_cle",
    "code_id": 54,
    "libelle": "brancardage"
  },
  {
    "_id": "motcle_55",
    "categorie": "mot_cle",
    "code_id": 55,
    "libelle": "briefing"
  },
  {
    "_id": "motcle_56",
    "categorie": "mot_cle",
    "code_id": 56,
    "libelle": "bruit"
  },
  {
    "_id": "motcle_57",
    "categorie": "mot_cle",
    "code_id": 57,
    "libelle": "bureau"
  },
  {
    "_id": "motcle_58",
    "categorie": "mot_cle",
    "code_id": 58,
    "libelle": "cadence"
  },
  {
    "_id": "motcle_59",
    "categorie": "mot_cle",
    "code_id": 59,
    "libelle": "calage"
  },
  {
    "_id": "motcle_60",
    "categorie": "mot_cle",
    "code_id": 60,
    "libelle": "calme"
  },
  {
    "_id": "motcle_61",
    "categorie": "mot_cle",
    "code_id": 61,
    "libelle": "capacité"
  },
  {
    "_id": "motcle_62",
    "categorie": "mot_cle",
    "code_id": 62,
    "libelle": "change"
  },
  {
    "_id": "motcle_63",
    "categorie": "mot_cle",
    "code_id": 63,
    "libelle": "chargement"
  },
  {
    "_id": "motcle_64",
    "categorie": "mot_cle",
    "code_id": 64,
    "libelle": "client"
  },
  {
    "_id": "motcle_65",
    "categorie": "mot_cle",
    "code_id": 65,
    "libelle": "coactivité"
  },
  {
    "_id": "motcle_66",
    "categorie": "mot_cle",
    "code_id": 66,
    "libelle": "commercial"
  },
  {
    "_id": "motcle_67",
    "categorie": "mot_cle",
    "code_id": 67,
    "libelle": "communication"
  },
  {
    "_id": "motcle_68",
    "categorie": "mot_cle",
    "code_id": 68,
    "libelle": "compétences"
  },
  {
    "_id": "motcle_69",
    "categorie": "mot_cle",
    "code_id": 69,
    "libelle": "concentration"
  },
  {
    "_id": "motcle_70",
    "categorie": "mot_cle",
    "code_id": 70,
    "libelle": "conduite"
  },
  {
    "_id": "motcle_71",
    "categorie": "mot_cle",
    "code_id": 71,
    "libelle": "conformité"
  },
  {
    "_id": "motcle_72",
    "categorie": "mot_cle",
    "code_id": 72,
    "libelle": "confort"
  },
  {
    "_id": "motcle_73",
    "categorie": "mot_cle",
    "code_id": 73,
    "libelle": "consignation"
  },
  {
    "_id": "motcle_74",
    "categorie": "mot_cle",
    "code_id": 74,
    "libelle": "consommation"
  },
  {
    "_id": "motcle_75",
    "categorie": "mot_cle",
    "code_id": 75,
    "libelle": "contentieux"
  },
  {
    "_id": "motcle_76",
    "categorie": "mot_cle",
    "code_id": 76,
    "libelle": "contrat"
  },
  {
    "_id": "motcle_77",
    "categorie": "mot_cle",
    "code_id": 77,
    "libelle": "contrôle"
  },
  {
    "_id": "motcle_78",
    "categorie": "mot_cle",
    "code_id": 78,
    "libelle": "convoyage"
  },
  {
    "_id": "motcle_79",
    "categorie": "mot_cle",
    "code_id": 79,
    "libelle": "coordination"
  },
  {
    "_id": "motcle_80",
    "categorie": "mot_cle",
    "code_id": 80,
    "libelle": "cotation"
  },
  {
    "_id": "motcle_81",
    "categorie": "mot_cle",
    "code_id": 81,
    "libelle": "coûts"
  },
  {
    "_id": "motcle_82",
    "categorie": "mot_cle",
    "code_id": 82,
    "libelle": "crise"
  },
  {
    "_id": "motcle_83",
    "categorie": "mot_cle",
    "code_id": 83,
    "libelle": "cross-docking"
  },
  {
    "_id": "motcle_84",
    "categorie": "mot_cle",
    "code_id": 84,
    "libelle": "data"
  },
  {
    "_id": "motcle_85",
    "categorie": "mot_cle",
    "code_id": 85,
    "libelle": "design"
  },
  {
    "_id": "motcle_86",
    "categorie": "mot_cle",
    "code_id": 86,
    "libelle": "diagnostic"
  },
  {
    "_id": "motcle_87",
    "categorie": "mot_cle",
    "code_id": 87,
    "libelle": "dimensionnement"
  },
  {
    "_id": "motcle_88",
    "categorie": "mot_cle",
    "code_id": 88,
    "libelle": "diplomatie"
  },
  {
    "_id": "motcle_89",
    "categorie": "mot_cle",
    "code_id": 89,
    "libelle": "discrétion"
  },
  {
    "_id": "motcle_90",
    "categorie": "mot_cle",
    "code_id": 90,
    "libelle": "disponibilité"
  },
  {
    "_id": "motcle_91",
    "categorie": "mot_cle",
    "code_id": 91,
    "libelle": "douane"
  },
  {
    "_id": "motcle_92",
    "categorie": "mot_cle",
    "code_id": 92,
    "libelle": "droit"
  }
]
);

db.vocabulaire.insertMany(
[
  {
    "_id": "motcle_93",
    "categorie": "mot_cle",
    "code_id": 93,
    "libelle": "délai"
  },
  {
    "_id": "motcle_94",
    "categorie": "mot_cle",
    "code_id": 94,
    "libelle": "déplacement"
  },
  {
    "_id": "motcle_95",
    "categorie": "mot_cle",
    "code_id": 95,
    "libelle": "déplacements"
  },
  {
    "_id": "motcle_96",
    "categorie": "mot_cle",
    "code_id": 96,
    "libelle": "développement"
  },
  {
    "_id": "motcle_97",
    "categorie": "mot_cle",
    "code_id": 97,
    "libelle": "eCMR"
  },
  {
    "_id": "motcle_98",
    "categorie": "mot_cle",
    "code_id": 98,
    "libelle": "eco-conduite"
  },
  {
    "_id": "motcle_99",
    "categorie": "mot_cle",
    "code_id": 99,
    "libelle": "emballage"
  },
  {
    "_id": "motcle_100",
    "categorie": "mot_cle",
    "code_id": 100,
    "libelle": "empathie"
  },
  {
    "_id": "motcle_101",
    "categorie": "mot_cle",
    "code_id": 101,
    "libelle": "encaissement"
  },
  {
    "_id": "motcle_102",
    "categorie": "mot_cle",
    "code_id": 102,
    "libelle": "endurance"
  },
  {
    "_id": "motcle_103",
    "categorie": "mot_cle",
    "code_id": 103,
    "libelle": "entrepreneurial"
  },
  {
    "_id": "motcle_104",
    "categorie": "mot_cle",
    "code_id": 104,
    "libelle": "entrepôt"
  },
  {
    "_id": "motcle_105",
    "categorie": "mot_cle",
    "code_id": 105,
    "libelle": "ergonomie"
  },
  {
    "_id": "motcle_106",
    "categorie": "mot_cle",
    "code_id": 106,
    "libelle": "escale"
  },
  {
    "_id": "motcle_107",
    "categorie": "mot_cle",
    "code_id": 107,
    "libelle": "exemplarité"
  },
  {
    "_id": "motcle_108",
    "categorie": "mot_cle",
    "code_id": 108,
    "libelle": "exploitation"
  },
  {
    "_id": "motcle_109",
    "categorie": "mot_cle",
    "code_id": 109,
    "libelle": "fatigue"
  },
  {
    "_id": "motcle_110",
    "categorie": "mot_cle",
    "code_id": 110,
    "libelle": "fatigue visuelle"
  },
  {
    "_id": "motcle_111",
    "categorie": "mot_cle",
    "code_id": 111,
    "libelle": "fermeté"
  },
  {
    "_id": "motcle_112",
    "categorie": "mot_cle",
    "code_id": 112,
    "libelle": "fidélisation"
  },
  {
    "_id": "motcle_113",
    "categorie": "mot_cle",
    "code_id": 113,
    "libelle": "filmage"
  },
  {
    "_id": "motcle_114",
    "categorie": "mot_cle",
    "code_id": 114,
    "libelle": "finance"
  },
  {
    "_id": "motcle_115",
    "categorie": "mot_cle",
    "code_id": 115,
    "libelle": "fleet"
  },
  {
    "_id": "motcle_116",
    "categorie": "mot_cle",
    "code_id": 116,
    "libelle": "flotte"
  },
  {
    "_id": "motcle_117",
    "categorie": "mot_cle",
    "code_id": 117,
    "libelle": "flux"
  },
  {
    "_id": "motcle_118",
    "categorie": "mot_cle",
    "code_id": 118,
    "libelle": "force"
  },
  {
    "_id": "motcle_119",
    "categorie": "mot_cle",
    "code_id": 119,
    "libelle": "forecast"
  },
  {
    "_id": "motcle_120",
    "categorie": "mot_cle",
    "code_id": 120,
    "libelle": "fragile"
  },
  {
    "_id": "motcle_121",
    "categorie": "mot_cle",
    "code_id": 121,
    "libelle": "freins"
  },
  {
    "_id": "motcle_122",
    "categorie": "mot_cle",
    "code_id": 122,
    "libelle": "gabarit"
  },
  {
    "_id": "motcle_123",
    "categorie": "mot_cle",
    "code_id": 123,
    "libelle": "gerbage"
  },
  {
    "_id": "motcle_124",
    "categorie": "mot_cle",
    "code_id": 124,
    "libelle": "gouvernance"
  },
  {
    "_id": "motcle_125",
    "categorie": "mot_cle",
    "code_id": 125,
    "libelle": "hauteur"
  },
  {
    "_id": "motcle_126",
    "categorie": "mot_cle",
    "code_id": 126,
    "libelle": "horaires"
  },
  {
    "_id": "motcle_127",
    "categorie": "mot_cle",
    "code_id": 127,
    "libelle": "humanitaire"
  },
  {
    "_id": "motcle_128",
    "categorie": "mot_cle",
    "code_id": 128,
    "libelle": "hydraulique"
  },
  {
    "_id": "motcle_129",
    "categorie": "mot_cle",
    "code_id": 129,
    "libelle": "hygiène"
  },
  {
    "_id": "motcle_130",
    "categorie": "mot_cle",
    "code_id": 130,
    "libelle": "implantation"
  },
  {
    "_id": "motcle_131",
    "categorie": "mot_cle",
    "code_id": 131,
    "libelle": "incoterms"
  },
  {
    "_id": "motcle_132",
    "categorie": "mot_cle",
    "code_id": 132,
    "libelle": "intégrité"
  },
  {
    "_id": "motcle_133",
    "categorie": "mot_cle",
    "code_id": 133,
    "libelle": "inventaire"
  },
  {
    "_id": "motcle_134",
    "categorie": "mot_cle",
    "code_id": 134,
    "libelle": "itinéraire"
  },
  {
    "_id": "motcle_135",
    "categorie": "mot_cle",
    "code_id": 135,
    "libelle": "kaizen"
  },
  {
    "_id": "motcle_136",
    "categorie": "mot_cle",
    "code_id": 136,
    "libelle": "leadership"
  },
  {
    "_id": "motcle_137",
    "categorie": "mot_cle",
    "code_id": 137,
    "libelle": "lean"
  },
  {
    "_id": "motcle_138",
    "categorie": "mot_cle",
    "code_id": 138,
    "libelle": "maintenance"
  },
  {
    "_id": "motcle_139",
    "categorie": "mot_cle",
    "code_id": 139,
    "libelle": "maintenance 1er niveau"
  },
  {
    "_id": "motcle_140",
    "categorie": "mot_cle",
    "code_id": 140,
    "libelle": "maintenance N1"
  },
  {
    "_id": "motcle_141",
    "categorie": "mot_cle",
    "code_id": 141,
    "libelle": "maintenance navale"
  },
  {
    "_id": "motcle_142",
    "categorie": "mot_cle",
    "code_id": 142,
    "libelle": "management"
  },
  {
    "_id": "motcle_143",
    "categorie": "mot_cle",
    "code_id": 143,
    "libelle": "manœuvres"
  },
  {
    "_id": "motcle_144",
    "categorie": "mot_cle",
    "code_id": 144,
    "libelle": "marche"
  },
  {
    "_id": "motcle_145",
    "categorie": "mot_cle",
    "code_id": 145,
    "libelle": "marge"
  },
  {
    "_id": "motcle_146",
    "categorie": "mot_cle",
    "code_id": 146,
    "libelle": "maritime"
  },
  {
    "_id": "motcle_147",
    "categorie": "mot_cle",
    "code_id": 147,
    "libelle": "montage"
  },
  {
    "_id": "motcle_148",
    "categorie": "mot_cle",
    "code_id": 148,
    "libelle": "méthode"
  },
  {
    "_id": "motcle_149",
    "categorie": "mot_cle",
    "code_id": 149,
    "libelle": "navigation fluviale"
  },
  {
    "_id": "motcle_150",
    "categorie": "mot_cle",
    "code_id": 150,
    "libelle": "négociation"
  },
  {
    "_id": "motcle_151",
    "categorie": "mot_cle",
    "code_id": 151,
    "libelle": "opérations"
  },
  {
    "_id": "motcle_152",
    "categorie": "mot_cle",
    "code_id": 152,
    "libelle": "outillage"
  },
  {
    "_id": "motcle_153",
    "categorie": "mot_cle",
    "code_id": 153,
    "libelle": "packing"
  },
  {
    "_id": "motcle_154",
    "categorie": "mot_cle",
    "code_id": 154,
    "libelle": "palettisation"
  },
  {
    "_id": "motcle_155",
    "categorie": "mot_cle",
    "code_id": 155,
    "libelle": "paramétrage WMS"
  },
  {
    "_id": "motcle_156",
    "categorie": "mot_cle",
    "code_id": 156,
    "libelle": "persuasion"
  },
  {
    "_id": "motcle_157",
    "categorie": "mot_cle",
    "code_id": 157,
    "libelle": "picking"
  },
  {
    "_id": "motcle_158",
    "categorie": "mot_cle",
    "code_id": 158,
    "libelle": "pilotage"
  },
  {
    "_id": "motcle_159",
    "categorie": "mot_cle",
    "code_id": 159,
    "libelle": "pièces"
  },
  {
    "_id": "motcle_160",
    "categorie": "mot_cle",
    "code_id": 160,
    "libelle": "planification"
  },
  {
    "_id": "motcle_161",
    "categorie": "mot_cle",
    "code_id": 161,
    "libelle": "planning"
  },
  {
    "_id": "motcle_162",
    "categorie": "mot_cle",
    "code_id": 162,
    "libelle": "pneumatique"
  },
  {
    "_id": "motcle_163",
    "categorie": "mot_cle",
    "code_id": 163,
    "libelle": "port"
  },
  {
    "_id": "motcle_164",
    "categorie": "mot_cle",
    "code_id": 164,
    "libelle": "port de charges"
  },
  {
    "_id": "motcle_165",
    "categorie": "mot_cle",
    "code_id": 165,
    "libelle": "posture"
  },
  {
    "_id": "motcle_166",
    "categorie": "mot_cle",
    "code_id": 166,
    "libelle": "postures"
  },
  {
    "_id": "motcle_167",
    "categorie": "mot_cle",
    "code_id": 167,
    "libelle": "pricing"
  },
  {
    "_id": "motcle_168",
    "categorie": "mot_cle",
    "code_id": 168,
    "libelle": "priorités"
  },
  {
    "_id": "motcle_169",
    "categorie": "mot_cle",
    "code_id": 169,
    "libelle": "processus"
  },
  {
    "_id": "motcle_170",
    "categorie": "mot_cle",
    "code_id": 170,
    "libelle": "procédure"
  },
  {
    "_id": "motcle_171",
    "categorie": "mot_cle",
    "code_id": 171,
    "libelle": "profitabilité"
  },
  {
    "_id": "motcle_172",
    "categorie": "mot_cle",
    "code_id": 172,
    "libelle": "project"
  },
  {
    "_id": "motcle_173",
    "categorie": "mot_cle",
    "code_id": 173,
    "libelle": "prospection"
  },
  {
    "_id": "motcle_174",
    "categorie": "mot_cle",
    "code_id": 174,
    "libelle": "prudence"
  },
  {
    "_id": "motcle_175",
    "categorie": "mot_cle",
    "code_id": 175,
    "libelle": "préparation"
  },
  {
    "_id": "motcle_176",
    "categorie": "mot_cle",
    "code_id": 176,
    "libelle": "pédagogie"
  },
  {
    "_id": "motcle_177",
    "categorie": "mot_cle",
    "code_id": 177,
    "libelle": "qualité"
  },
  {
    "_id": "motcle_178",
    "categorie": "mot_cle",
    "code_id": 178,
    "libelle": "raisonnement"
  },
  {
    "_id": "motcle_179",
    "categorie": "mot_cle",
    "code_id": 179,
    "libelle": "recommandation"
  },
  {
    "_id": "motcle_180",
    "categorie": "mot_cle",
    "code_id": 180,
    "libelle": "relation client"
  },
  {
    "_id": "motcle_181",
    "categorie": "mot_cle",
    "code_id": 181,
    "libelle": "rentabilité"
  },
  {
    "_id": "motcle_182",
    "categorie": "mot_cle",
    "code_id": 182,
    "libelle": "replanif"
  },
  {
    "_id": "motcle_183",
    "categorie": "mot_cle",
    "code_id": 183,
    "libelle": "rigueur"
  },
  {
    "_id": "motcle_184",
    "categorie": "mot_cle",
    "code_id": 184,
    "libelle": "risque"
  },
  {
    "_id": "motcle_185",
    "categorie": "mot_cle",
    "code_id": 185,
    "libelle": "risques"
  },
  {
    "_id": "motcle_186",
    "categorie": "mot_cle",
    "code_id": 186,
    "libelle": "routine"
  },
  {
    "_id": "motcle_187",
    "categorie": "mot_cle",
    "code_id": 187,
    "libelle": "routing"
  },
  {
    "_id": "motcle_188",
    "categorie": "mot_cle",
    "code_id": 188,
    "libelle": "réactivité"
  },
  {
    "_id": "motcle_189",
    "categorie": "mot_cle",
    "code_id": 189,
    "libelle": "réappro"
  },
  {
    "_id": "motcle_190",
    "categorie": "mot_cle",
    "code_id": 190,
    "libelle": "réclamation"
  },
  {
    "_id": "motcle_191",
    "categorie": "mot_cle",
    "code_id": 191,
    "libelle": "réseau"
  },
  {
    "_id": "motcle_192",
    "categorie": "mot_cle",
    "code_id": 192,
    "libelle": "résilience"
  }
]
);

db.vocabulaire.insertMany(
[
  {
    "_id": "motcle_193",
    "categorie": "mot_cle",
    "code_id": 193,
    "libelle": "s&op"
  },
  {
    "_id": "motcle_194",
    "categorie": "mot_cle",
    "code_id": 194,
    "libelle": "scan"
  },
  {
    "_id": "motcle_195",
    "categorie": "mot_cle",
    "code_id": 195,
    "libelle": "service client"
  },
  {
    "_id": "motcle_196",
    "categorie": "mot_cle",
    "code_id": 196,
    "libelle": "simulation"
  },
  {
    "_id": "motcle_197",
    "categorie": "mot_cle",
    "code_id": 197,
    "libelle": "social"
  },
  {
    "_id": "motcle_198",
    "categorie": "mot_cle",
    "code_id": 198,
    "libelle": "soin"
  },
  {
    "_id": "motcle_199",
    "categorie": "mot_cle",
    "code_id": 199,
    "libelle": "sous-traitance"
  },
  {
    "_id": "motcle_200",
    "categorie": "mot_cle",
    "code_id": 200,
    "libelle": "spot"
  },
  {
    "_id": "motcle_201",
    "categorie": "mot_cle",
    "code_id": 201,
    "libelle": "stakeholders"
  },
  {
    "_id": "motcle_202",
    "categorie": "mot_cle",
    "code_id": 202,
    "libelle": "stats"
  },
  {
    "_id": "motcle_203",
    "categorie": "mot_cle",
    "code_id": 203,
    "libelle": "stock"
  },
  {
    "_id": "motcle_204",
    "categorie": "mot_cle",
    "code_id": 204,
    "libelle": "stock de sécurité"
  },
  {
    "_id": "motcle_205",
    "categorie": "mot_cle",
    "code_id": 205,
    "libelle": "stratégie"
  },
  {
    "_id": "motcle_206",
    "categorie": "mot_cle",
    "code_id": 206,
    "libelle": "stress"
  },
  {
    "_id": "motcle_207",
    "categorie": "mot_cle",
    "code_id": 207,
    "libelle": "supervision"
  },
  {
    "_id": "motcle_208",
    "categorie": "mot_cle",
    "code_id": 208,
    "libelle": "surface"
  },
  {
    "_id": "motcle_209",
    "categorie": "mot_cle",
    "code_id": 209,
    "libelle": "système D"
  },
  {
    "_id": "motcle_210",
    "categorie": "mot_cle",
    "code_id": 210,
    "libelle": "sécurité"
  },
  {
    "_id": "motcle_211",
    "categorie": "mot_cle",
    "code_id": 211,
    "libelle": "sédentarité"
  },
  {
    "_id": "motcle_212",
    "categorie": "mot_cle",
    "code_id": 212,
    "libelle": "sûreté"
  },
  {
    "_id": "motcle_213",
    "categorie": "mot_cle",
    "code_id": 213,
    "libelle": "tachy"
  },
  {
    "_id": "motcle_214",
    "categorie": "mot_cle",
    "code_id": 214,
    "libelle": "tarifaire"
  },
  {
    "_id": "motcle_215",
    "categorie": "mot_cle",
    "code_id": 215,
    "libelle": "terrain"
  },
  {
    "_id": "motcle_216",
    "categorie": "mot_cle",
    "code_id": 216,
    "libelle": "timing"
  },
  {
    "_id": "motcle_217",
    "categorie": "mot_cle",
    "code_id": 217,
    "libelle": "tracking"
  },
  {
    "_id": "motcle_218",
    "categorie": "mot_cle",
    "code_id": 218,
    "libelle": "transmission"
  },
  {
    "_id": "motcle_219",
    "categorie": "mot_cle",
    "code_id": 219,
    "libelle": "transpalette"
  },
  {
    "_id": "motcle_220",
    "categorie": "mot_cle",
    "code_id": 220,
    "libelle": "transversal"
  },
  {
    "_id": "motcle_221",
    "categorie": "mot_cle",
    "code_id": 221,
    "libelle": "traçabilité"
  },
  {
    "_id": "motcle_222",
    "categorie": "mot_cle",
    "code_id": 222,
    "libelle": "tri"
  },
  {
    "_id": "motcle_223",
    "categorie": "mot_cle",
    "code_id": 223,
    "libelle": "urbain"
  },
  {
    "_id": "motcle_224",
    "categorie": "mot_cle",
    "code_id": 224,
    "libelle": "urgence"
  },
  {
    "_id": "motcle_225",
    "categorie": "mot_cle",
    "code_id": 225,
    "libelle": "veille"
  },
  {
    "_id": "motcle_226",
    "categorie": "mot_cle",
    "code_id": 226,
    "libelle": "vigilance"
  },
  {
    "_id": "motcle_227",
    "categorie": "mot_cle",
    "code_id": 227,
    "libelle": "vision"
  },
  {
    "_id": "motcle_228",
    "categorie": "mot_cle",
    "code_id": 228,
    "libelle": "voice picking"
  },
  {
    "_id": "motcle_229",
    "categorie": "mot_cle",
    "code_id": 229,
    "libelle": "zéro défaut"
  },
  {
    "_id": "motcle_230",
    "categorie": "mot_cle",
    "code_id": 230,
    "libelle": "écarts"
  },
  {
    "_id": "motcle_231",
    "categorie": "mot_cle",
    "code_id": 231,
    "libelle": "écoute"
  },
  {
    "_id": "motcle_232",
    "categorie": "mot_cle",
    "code_id": 232,
    "libelle": "électronique"
  },
  {
    "_id": "motcle_233",
    "categorie": "mot_cle",
    "code_id": 233,
    "libelle": "équipe"
  },
  {
    "_id": "motcle_234",
    "categorie": "mot_cle",
    "code_id": 234,
    "libelle": "étiquetage"
  }
]
);

// =============================================================================
// 6. EXAMPLE QUERIES
// =============================================================================

// ── Q1: Get full profile of a metier with all competences ─────────────────────
db.metiers.findOne({ nom_metier: 'Conducteur Routier (PL/SPL)' });

// ── Q2: Get all competences for a specific metier ────────────────────────────
db.metiers.findOne(
  { nom_metier: 'Conducteur Routier (PL/SPL)' },
  { nom_metier: 1, competences: 1, _id: 0 }
);

// ── Q3: Filter competences by type within a metier ──────────────────────────
db.metiers.aggregate([
  { $match: { nom_metier: 'Mécanicien Poids Lourds' } },
  { $unwind: '$competences' },
  { $match: { 'competences.type_competence': 'Technique' } },
  { $replaceRoot: { newRoot: '$competences' } }
]);

// ── Q4: Search metiers by keyword (mots_cles) ─────────────────────────────────
db.metiers.find(
  { 'competences.mots_cles': { $in: ['sécurité', 'coordination'] } },
  { nom_metier: 1, 'domaine.nom_domaine': 1, nb_competences: 1 }
);

// ── Q5: Find all metiers using a specific tool ────────────────────────────────
db.metiers.find(
  { 'competences.outils': 'WMS' },
  { nom_metier: 1, 'domaine.nom_domaine': 1 }
);

// ── Q6: Full-text search across competences ──────────────────────────────────
db.metiers.find(
  { $text: { $search: 'conduite sécurité', $language: 'french' } },
  { score: { $meta: 'textScore' }, nom_metier: 1 }
).sort({ score: { $meta: 'textScore' } });

// ── Q7: Matching system — score metiers by keyword overlap ──────────────────
// Candidate skills from a CV
const cvSkills = ['coordination', 'stress', 'autonomie', 'Excel', 'WMS'];

db.metiers.aggregate([
  { $unwind: '$competences' },
  { $unwind: '$competences.mots_cles' },
  { $match: { 'competences.mots_cles': { $in: cvSkills } } },
  { $group: {
      _id: '$_id',
      nom_metier: { $first: '$nom_metier' },
      domaine: { $first: '$domaine.nom_domaine' },
      matches: { $sum: 1 },
      matched_keywords: { $addToSet: '$competences.mots_cles' }
  }},
  { $sort: { matches: -1 } },
  { $limit: 5 }
]);

// ── Q8: All metiers per domaine with competence count ─────────────────────────
db.metiers.aggregate([
  { $group: {
      _id: '$domaine.nom_domaine',
      metiers: { $push: { nom: '$nom_metier', nb_comp: '$nb_competences' } },
      total_competences: { $sum: '$nb_competences' }
  }},
  { $sort: { _id: 1 } }
]);

// ── Q9: Count competences by type across all metiers ─────────────────────────
db.metiers.aggregate([
  { $unwind: '$competences' },
  { $group: {
      _id: '$competences.type_competence',
      count: { $sum: 1 },
      metiers_concernes: { $addToSet: '$nom_metier' }
  }},
  { $sort: { count: -1 } }
]);

// ── Q10: Top 10 most common mots_cles across all competences ─────────────────
db.metiers.aggregate([
  { $unwind: '$competences' },
  { $unwind: '$competences.mots_cles' },
  { $group: { _id: '$competences.mots_cles', count: { $sum: 1 } }},
  { $sort: { count: -1 } },
  { $limit: 10 }
]);

// =============================================================================
// 7. VERIFICATION — Document counts
// =============================================================================

print('metiers:     ' + db.metiers.countDocuments());
print('domaines:    ' + db.domaines.countDocuments());
print('vocabulaire: ' + db.vocabulaire.countDocuments());

// =============================================================================
// END OF SCRIPT
// =============================================================================
