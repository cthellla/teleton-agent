# Bot Mode — Suggestions d'implémentation

> Analyse croisée : API Bot Telegram (v9.5, mars 2026) × teleton-agent bot mode actuel.
> Classement par valeur pour un agent IA autonome.

---

## État actuel du bot mode

### Ce qui fonctionne

| Catégorie | Outils |
|---|---|
| Messages | `sendMessage`, `editMessage`, `deleteMessage`, `forwardMessage`, `pinMessage` |
| Média | `sendPhoto` (seul média implémenté) |
| Interactif | `sendButtons` (inline keyboard + callback nonce), `sendDice`, `react` |
| Info | `getMe`, `getChatInfo` |
| Inline | DealBot (inline queries, chosen results, styled buttons via MTProto) |
| Plugins | `BotSDK` — inline queries, callbacks, chosenResult par plugin |
| Mémoire | `memory_write`, `memory_read`, `memory_search` |
| Web | `web_fetch`, `web_search` |
| TON | Tous les outils wallet/DeDust/StonFi/deal |
| Workspace | read/write/delete/rename files |
| Exec | run/status/install/audit |

### Bugs / lacunes connues

| Problème | Détail |
|---|---|
| `getMessages` vide | `GrammyBotBridge.getMessages()` retourne `[]` — pas de dégradation gracieuse |
| Plugin `onCallbackQuery` hooks | TODO dans `src/index.ts:1222` — hooks plugins jamais appelés en bot mode |
| `TELEGRAM_SEND_TOOLS` fantômes | `telegram_send_document`, `telegram_send_video`, `telegram_send_poll` référencés mais non implémentés |
| Polls/Quiz/ReplyKeyboard | Filtrés `requiredMode: "user"` alors que Bot API les supporte nativement |
| Pas de command routing | `/start`, `/help` arrivent comme texte brut — pas d'infrastructure de commandes |

---

## Priorité 1 — Game changers

### 1.1 `sendMessageDraft` — Streaming de réponses

**API** : `sendMessageDraft` (Bot API 9.3+, ouvert à tous les bots en 9.5)

**Impact** : Élimine le temps d'attente mort. L'utilisateur voit la réponse se construire token par token, comme ChatGPT. C'est LA feature qui transforme l'UX d'un agent IA en bot.

**Implémentation** :
- Ajouter `sendMessageDraft(chatId, text, businessConnectionId?)` à `ITelegramBridge`
- Implémenter dans `GrammyBotBridge` via `bot.api.raw.sendMessageDraft`
- Modifier le pipeline de réponse agent pour streamer les chunks au lieu d'envoyer un message final
- Envoyer `sendMessage` final quand la génération est terminée (le draft disparaît)

**Complexité** : Moyenne — nécessite de modifier le flow de réponse agent
**Valeur** : ★★★★★

---

### 1.2 Envoi de médias complets

**API** : `sendDocument`, `sendVideo`, `sendAudio`, `sendVoice`, `sendAnimation`, `sendVideoNote`, `sendMediaGroup`

**Impact** : L'agent ne peut actuellement envoyer que des photos. Impossible d'envoyer un fichier, une note vocale, une vidéo, un GIF, ou un album.

**Implémentation** :

#### 1.2a `sendDocument`
- Outil `telegram_send_document` — envoyer fichiers (rapports, exports, code, PDF)
- Params : `chatId`, `filePath | url | fileId`, `caption?`, `replyToMessageId?`
- Bridge : `sendDocument(chatId, file, opts)` dans `ITelegramBridge`

#### 1.2b `sendVoice`
- Outil `telegram_send_voice` — messages vocaux OGG/OPUS
- Cas d'usage : TTS, réponses audio, résumés vocaux
- Params : `chatId`, `filePath | buffer`, `caption?`, `duration?`

#### 1.2c `sendVideo`
- Outil `telegram_send_video` — vidéos MP4
- Params : `chatId`, `filePath | url | fileId`, `caption?`, `supportsStreaming?`

#### 1.2d `sendAnimation`
- Outil `telegram_send_gif` — GIFs et vidéos sans son
- Cas d'usage : réponses expressives, démonstrations visuelles

#### 1.2e `sendMediaGroup`
- Outil `telegram_send_album` — albums de 2-10 médias
- Params : `chatId`, `media[]` (photo/video/audio/document avec captions)

#### 1.2f `sendVideoNote`
- Outil `telegram_send_video_note` — vidéos circulaires
- Plus personnel, format natif Telegram

**Complexité** : Faible par média — Grammy expose tout nativement
**Valeur** : ★★★★★

---

### 1.3 Polls & Quiz

**API** : `sendPoll` (type: regular | quiz)

**Impact** : Interactions structurées — sondages, quiz, collecte d'avis, votes. Actuellement filtré `requiredMode: "user"` sans raison technique.

**Implémentation** :
- Retirer `requiredMode: "user"` des outils poll/quiz existants
- Adapter pour utiliser Grammy au lieu de GramJS
- `sendPoll` : `chatId`, `question`, `options[]`, `isAnonymous?`, `allowsMultipleAnswers?`
- `sendQuiz` : ajouter `correctOptionId`, `explanation`
- Écouter les updates `poll_answer` pour que l'agent reçoive les réponses

**Complexité** : Faible — outils existants, juste à rewirer
**Valeur** : ★★★★☆

---

### 1.4 Reply Keyboard

**API** : `ReplyKeyboardMarkup`, `ReplyKeyboardRemove`, `ForceReply`

**Impact** : Clavier custom sous le champ texte. Guide l'utilisateur vers des choix sans inline keyboard. `is_persistent` + `input_field_placeholder` créent une UX de menu permanent.

**Implémentation** :
- Outil `telegram_reply_keyboard` — afficher un clavier custom
  - Params : `chatId`, `text`, `buttons[][]`, `resize?`, `oneTime?`, `persistent?`, `placeholder?`
- Outil `telegram_remove_keyboard` — retirer le clavier
- `ForceReply` — forcer l'interface de réponse (utile pour les formulaires step-by-step)

**Complexité** : Faible
**Valeur** : ★★★★☆

---

## Priorité 2 — Fonctionnalités enrichissantes

### 2.1 Gestion de groupe (admin bot)

**API** : `banChatMember`, `unbanChatMember`, `restrictChatMember`, `promoteChatMember`, `setChatAdministratorCustomTitle`, `setChatPermissions`, `getChatMemberCount`, `getChatAdministrators`, `setChatTitle`, `setChatDescription`, `setChatPhoto`, `deleteChatPhoto`

**Impact** : L'agent devient un admin de groupe autonome — modération, gestion des membres, configuration.

**Implémentation** :
- `telegram_ban_user` — ban/kick (adapter l'outil user-mode existant pour Grammy)
- `telegram_unban_user` — unban
- `telegram_restrict_user` — mute, interdire médias, etc.
- `telegram_promote_user` — promouvoir admin avec droits spécifiques
- `telegram_set_chat_title` / `telegram_set_chat_description` / `telegram_set_chat_photo`
- `telegram_get_members` — lister admins et count

**Complexité** : Moyenne — beaucoup de méthodes mais simples individuellement
**Valeur** : ★★★★☆

---

### 2.2 Liens d'invitation

**API** : `createChatInviteLink`, `editChatInviteLink`, `revokeChatInviteLink`, `exportChatInviteLink`, `createChatSubscriptionInviteLink`, `approveChatJoinRequest`, `declineChatJoinRequest`

**Impact** : L'agent crée et gère des liens d'invitation, y compris des liens avec abonnement Stars. Valide ou refuse les demandes d'accès.

**Implémentation** :
- `telegram_create_invite_link` — créer un lien (avec `member_limit`, `expire_date`, `creates_join_request`)
- `telegram_create_subscription_link` — lien avec abonnement Stars
- `telegram_approve_join` / `telegram_decline_join` — gérer les demandes
- Écouter l'update `chat_join_request`

**Complexité** : Faible
**Valeur** : ★★★☆☆

---

### 2.3 Forum Topics

**API** : `createForumTopic`, `editForumTopic`, `closeForumTopic`, `reopenForumTopic`, `deleteForumTopic`, `unpinAllForumTopicMessages`

**Impact** : Dans les groupes avec topics, l'agent organise les discussions par thème. Crée des topics automatiquement (par sujet, par utilisateur, par projet).

**Implémentation** :
- `telegram_create_topic` — créer un topic (name, icon_color, icon_custom_emoji_id)
- `telegram_manage_topic` — close/reopen/delete/edit
- Utiliser `message_thread_id` dans tous les send tools pour cibler un topic

**Complexité** : Faible
**Valeur** : ★★★☆☆

---

### 2.4 Configuration bot dynamique

**API** : `setMyCommands`, `deleteMyCommands`, `setMyName`, `setMyDescription`, `setMyShortDescription`, `setChatMenuButton`, `setMyProfilePhoto` (9.4+), `setMyDefaultAdministratorRights`

**Impact** : L'agent configure son identité et son menu de commandes dynamiquement selon les plugins chargés, le contexte, ou les préférences utilisateur.

**Implémentation** :
- `telegram_set_commands` — enregistrer les commandes slash
  - Auto-générer depuis les plugins chargés + outils disponibles
  - Support des scopes (par chat, par user, global)
- `telegram_set_bot_info` — nom, description, short description
- `telegram_set_menu_button` — personnaliser le bouton menu par user
- `telegram_set_profile_photo` — changer la photo de profil

**Complexité** : Faible
**Valeur** : ★★★☆☆

---

### 2.5 `copyMessage` sans attribution

**API** : `copyMessage`, `copyMessages` (batch jusqu'à 100)

**Impact** : L'agent copie des messages entre chats sans header "Forwarded from". Utile pour la curation de contenu, le cross-posting, les résumés.

**Implémentation** :
- `telegram_copy_message` — copier un message proprement
  - Params : `fromChatId`, `messageId`, `toChatId`, `caption?`

**Complexité** : Très faible
**Valeur** : ★★★☆☆

---

## Priorité 3 — Monétisation & économie

### 3.1 Paiements Telegram Stars

**API** : `sendInvoice`, `answerShippingQuery`, `answerPreCheckoutQuery`, `refundStarPayment`, `getStarTransactions`, `getMyStarBalance`

**Impact** : L'agent facture ses services directement dans Telegram. Modèle freemium natif sans infrastructure de paiement externe.

**Cas d'usage** :
- Facturer l'accès à des fonctionnalités premium
- Vendre du contenu (analyses, rapports)
- Pay-per-query pour des services coûteux (vision, recherche web)
- Abonnements via `createChatSubscriptionInviteLink`

**Implémentation** :
- `telegram_send_invoice` — créer et envoyer une facture
  - Params : `chatId`, `title`, `description`, `payload`, `currency` ("XTR" pour Stars), `prices[]`
- Handler pour `pre_checkout_query` — valider le paiement
- Handler pour `successful_payment` — livrer le service
- `telegram_refund` — rembourser un paiement Stars
- `telegram_get_balance` — consulter le solde Stars
- `telegram_get_transactions` — historique des transactions

**Complexité** : Élevée — flow asynchrone avec callbacks
**Valeur** : ★★★★☆

---

### 3.2 Paid Media

**API** : `sendPaidMedia`

**Impact** : L'agent partage des photos/vidéos derrière un paywall en Stars (jusqu'à 25 000⭐). L'utilisateur paie pour voir le contenu.

**Implémentation** :
- `telegram_send_paid_media` — envoyer du contenu payant
  - Params : `chatId`, `starCount`, `media[]` (photos/vidéos), `caption?`
- Écouter `purchased_paid_media` pour les achats

**Complexité** : Moyenne
**Valeur** : ★★★☆☆

---

### 3.3 Cadeaux

**API** : `getAvailableGifts`, `sendGift`, `giftPremiumSubscription`, `getUserGifts`

**Impact** : Gamification — l'agent récompense les utilisateurs avec des cadeaux Telegram. Peut aussi offrir Telegram Premium.

**Implémentation** :
- `telegram_send_gift` — envoyer un cadeau
- `telegram_list_gifts` — lister les cadeaux disponibles
- `telegram_get_user_gifts` — voir les cadeaux reçus par un user

**Complexité** : Faible
**Valeur** : ★★☆☆☆

---

## Priorité 4 — Nice to have

### 4.1 Stickers & Custom Emoji

**API** : `sendSticker`, `getStickerSet`, `getCustomEmojiStickers`, `createNewStickerSet`, `addStickerToSet`

**Impact** : Réponses expressives avec stickers. L'agent peut créer son propre sticker set.

**Implémentation** :
- `telegram_send_sticker` — envoyer un sticker par file_id ou set name
- `telegram_search_stickers` — chercher dans les sets

**Complexité** : Faible
**Valeur** : ★★☆☆☆

---

### 4.2 Checklist (9.1+)

**API** : `sendChecklist`, `editMessageChecklist`

**Impact** : Todo-lists interactives avec cases à cocher. Utile pour le suivi de tâches, les projets collaboratifs.

**Implémentation** :
- `telegram_send_checklist` — envoyer une checklist
  - Params : `chatId`, `title`, `tasks[]` (text + checked?)
- `telegram_edit_checklist` — modifier les tâches

**Complexité** : Faible
**Valeur** : ★★★☆☆

---

### 4.3 Inline mode générique

**API** : `answerInlineQuery` (déjà implémenté pour DealBot)

**Impact** : L'agent est invocable depuis n'importe quel chat via `@botname query`. Recherche web, TON lookup, mémoire — tout accessible inline.

**Implémentation** :
- Étendre `InlineRouter` avec un handler "agent" par défaut
- Le query inline est traité par le LLM → résultats formatés en `InlineQueryResultArticle`
- Exemples : `@bot search solana price`, `@bot ton wallet TQ...`, `@bot memo meeting notes`

**Complexité** : Élevée — LLM dans la boucle inline (timeout 10s)
**Valeur** : ★★★☆☆

---

### 4.4 Webhook (vs long-polling)

**API** : `setWebhook`, `deleteWebhook`, `getWebhookInfo`

**Impact** : Plus scalable que `getUpdates`. Temps réel sans polling. Requis pour le déploiement en production serverless.

**Implémentation** :
- Grammy supporte les deux modes nativement
- Intégrer avec le serveur Hono existant (`/webhook` endpoint)
- `secret_token` pour sécuriser le endpoint

**Complexité** : Moyenne
**Valeur** : ★★☆☆☆

---

### 4.5 Réactions payantes

**API** : `setMessageReaction` avec `ReactionTypePaid`

**Impact** : L'agent peut mettre des réactions payantes (Stars) sur les messages des utilisateurs. Micro-monétisation ou gamification.

**Complexité** : Très faible (extension de `telegram_react`)
**Valeur** : ★☆☆☆☆

---

## Hors scope — Non pertinent pour un agent IA

| Feature | Raison |
|---|---|
| Telegram Passport (`setPassportDataErrors`) | Vérification d'identité documentaire — hors scope |
| Games (`sendGame`, `setGameScore`, `getGameHighScores`) | L'agent n'est pas une plateforme de jeu |
| Stories (`postStory`, `editStory`, `deleteStory`) | Marketing/social — pas le rôle d'un agent |
| Business account management (15+ méthodes) | Gestion de compte entreprise — trop spécifique |
| Verification (`verifyUser`, `verifyChat`) | Réservé aux bots d'organisations vérifiées |
| Suggested posts (`approveSuggestedPost`) | Niche éditoriale pour canaux |
| Chat boosts (`getUserChatBoosts`) | Lecture seule, pas actionnable |

---

## Plan d'implémentation suggéré

### Phase 1 — Quick wins (faible complexité, haute valeur)
1. Débloquer polls/quiz en bot mode (rewire Grammy)
2. `sendDocument`, `sendVoice`, `sendVideo`, `sendAnimation`
3. Reply Keyboard + ForceReply
4. `copyMessage`
5. `setMyCommands` dynamique

### Phase 2 — UX révolutionnaire
6. `sendMessageDraft` — streaming de réponses
7. `sendMediaGroup` — albums

### Phase 3 — Admin & groupes
8. Gestion des membres (ban/restrict/promote)
9. Forum topics
10. Liens d'invitation + join requests

### Phase 4 — Monétisation
11. Paiements Stars (sendInvoice + flow complet)
12. Paid media
13. Cadeaux

### Phase 5 — Polish
14. Inline mode générique
15. Checklist
16. Stickers
17. Webhook mode
18. Configuration bot dynamique (nom, photo, description)

---

*Généré le 2026-03-21 — basé sur Bot API 9.5 et l'audit du codebase teleton-agent.*
