-- The rest of the list: a user picks 3 to 5 of these 10 questions.
INSERT INTO "security_questions" ("id", "text") VALUES
  (gen_random_uuid(), 'Quel est le prénom de votre meilleur ami d’enfance ?'),
  (gen_random_uuid(), 'Quel est le prénom de votre premier enseignant ?'),
  (gen_random_uuid(), 'Quel plat préfériez-vous quand vous étiez enfant ?'),
  (gen_random_uuid(), 'Quel métier vouliez-vous faire quand vous étiez enfant ?'),
  (gen_random_uuid(), 'Quel est le prénom de votre premier voisin ?'),
  (gen_random_uuid(), 'Quelle est la première ville que vous avez visitée ?'),
  (gen_random_uuid(), 'Quelle chanson aimiez-vous le plus quand vous étiez enfant ?');
