# Инсталиране в Cloudflare (безплатно)

Нужни са Cloudflare акаунт и достъп до това GitHub repo. Не е нужна кредитна карта.

## 1. Worker, свързан с GitHub

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Свържи GitHub и избери `racknotes`.
3. Настройки на build-а:
   - Build command: `npm ci && npm run check && npm test && npm run build` — червен тест спира deploy-а
   - Deploy command: `npx wrangler deploy`
4. **Deploy**. Адресът е `https://racknotes.asenkostov.eu` (зададен в `wrangler.jsonc` → `routes`; DNS записът се създава автоматично).

Всеки push в `main` прави нов deploy автоматично, но само ако проверките и тестовете минат. Месечното обновяване на каталога (`catalog.yml`) не пише в `main`, а отваря pull request (в GitHub → Settings → Actions → General трябва да е включено **Allow GitHub Actions to create and approve pull requests**).

## 2. Вход с Cloudflare Access

Без тази стъпка приложението е отворено за всеки, който знае адреса. На етап 1 данните са само в телефона, но Access трябва да е включен преди етап 2.

1. **Workers & Pages** → `racknotes` → **Settings** → **Domains & Routes** (или раздел **Access**) → **Enable Cloudflare Access** → избери **All traffic** (не само previews).
2. **Manage Cloudflare Access** → в политиката: **Allow**, Include → **Emails ending in** → домейна на фирмата (или изброени имейли).
3. **Zero Trust** → **Settings** → **Authentication** → провери, че **One-time PIN** е включен.
4. Session duration: **24 часа**. По-дълга сесия значи, че изгубен телефон или напуснал служител има достъп до всички клиенти дни наред (виж [PRIVACY.md](PRIVACY.md)).

Входът е с код по имейл — без O365 и без лицензи. Безплатно е до 50 потребители. Политиката е закачена за самия Worker, така че покрива всеки негов адрес.

## 3. На телефона

- **Android:** отвори адреса в Chrome → влез → меню ⋮ → **Install app**.
- **iPhone:** отвори в Safari → влез → Споделяне → **Add to Home Screen**.

Отвори приложението веднъж онлайн; след това работи и без връзка.

## Локално с wrangler

```bash
npm ci && npm run build
npx wrangler dev            # http://localhost:8787
npx wrangler deploy         # ръчен deploy (изисква `npx wrangler login`)
```

## Тестови версии по клонове

Всеки клон, различен от `main`, се качва като отделна тестова версия на
`https://<име-на-клона>.racknotes.asenkostov.eu` (точките и наклонените черти в името стават тирета),
зад същата Access политика. `main` е основната версия на `https://racknotes.asenkostov.eu`.

Настройката е в `wrangler.jsonc`: `previews_enabled: true` на домейна и блок `previews` със собствени `vars` и D1 бази (`racknotes-preview`, `racknotes-photos-preview`), така че тестовите версии никога не пипат данните от продукцията.

## Бекъп и връщане

**Автоматично:** D1 Time Travel пази всяка база 7 дни назад (безплатния план). Не изисква настройка.

**Ръчно копие извън Cloudflare** — веднъж седмично и преди всяка промяна на схемата:

```bash
npx wrangler d1 export racknotes --remote --output=racknotes-$(date +%F).sql
npx wrangler d1 export racknotes-photos-eu --remote --output=racknotes-photos-$(date +%F).sql
```

Файловете съдържат данни на клиенти: пазят се само в служебно криптирано хранилище.

**Учебно възстановяване (на тестовата база, никога на продукцията):**

```bash
npx wrangler d1 time-travel info racknotes-preview               # текущ bookmark
# … промени нещо в тестовата версия …
npx wrangler d1 time-travel restore racknotes-preview --timestamp=<ISO време преди промяната>
```

Или от копие: `npx wrangler d1 execute racknotes-preview --remote --file=racknotes-<дата>.sql` върху празна база.

**Връщане на кода:** `npx wrangler deployments list` и `npx wrangler rollback <version-id>`. Схемата на базата се създава от самия Worker (`CREATE TABLE IF NOT EXISTS`), затова отделни миграции няма; промяна на схема изисква ръчно копие преди нея.
