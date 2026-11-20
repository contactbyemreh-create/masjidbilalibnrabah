# Site de la mosquée Bilal Ben Rabah — front + back

- `public/index.html` : le site (horaires Mawaqit, dons, actualités, activités, espace responsable)
- `src/index.js` : API (Cloudflare Worker) — publication protégée par mot de passe
- `schema.sql` : tables D1 (posts, settings, attempts)

## Déploiement (Cloudflare, ~5 minutes)
1. `npm i -g wrangler` puis `wrangler login`
2. `wrangler d1 create mosquee-bilal` → copier le `database_id` dans `wrangler.toml`
3. `wrangler d1 execute mosquee-bilal --remote --file=schema.sql`
4. `wrangler secret put ADMIN_PASSWORD` (mot de passe des responsables)
   `wrangler secret put SESSION_SECRET` (longue chaîne aléatoire, 32+ caractères)
5. `wrangler deploy`, puis rattacher le nom de domaine dans Cloudflare.

## Utilisation
Pied de page → « Espace responsable » → mot de passe → publier actualités/activités, coller les liens Stripe (don libre, mensuel).

## Sécurité
Mot de passe jamais dans le code (secrets), jeton signé 12 h, 5 essais max / 15 min / IP, validation serveur, contenu inséré en texte (pas de HTML). Ajouter si possible une règle Cloudflare WAF de limitation de débit sur `/api/*`.

## Récitation au défilement (optionnel)
Un bouton « Écouter la récitation » apparaît si des MP3 sont présents dans `public/audio/` (voir `LISEZMOI.txt`).
Activé par le visiteur, le son s'intensifie et devient plus net quand les versets approchent du centre de l'écran, puis s'estompe quand on s'éloigne.
