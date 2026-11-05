# Инсталиране в Cloudflare (безплатно)

Нужни са Cloudflare акаунт и достъп до това GitHub repo. Не е нужна кредитна карта.

## 1. Worker, свързан с GitHub

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Свържи GitHub и избери `racknotes`.
3. Настройки на build-а:
   - Build command: `npm ci && npm run build`
   - Deploy command: `npx wrangler deploy`
4. **Deploy**. Получаваш адрес от вида `https://racknotes.<акаунт>.workers.dev`.

Всеки push в `main` прави нов deploy автоматично.

## 2. Вход с Cloudflare Access

Без тази стъпка приложението е отворено за всеки, който знае адреса. На етап 1 данните са само в телефона, но Access трябва да е включен преди етап 2.

1. **Workers & Pages** → `racknotes` → **Settings** → **Domains & Routes** (или раздел **Access**) → **Enable Cloudflare Access** → избери **All traffic** (не само previews).
2. **Manage Cloudflare Access** → в политиката: **Allow**, Include → **Emails ending in** → домейна на фирмата (или изброени имейли).
3. **Zero Trust** → **Settings** → **Authentication** → провери, че **One-time PIN** е включен.
4. Session duration: например 7 дни, за да не се влиза всеки ден на терен.

Входът е с код по имейл — без O365 и без лицензи. Безплатно е до 50 потребители. Политиката е закачена за самия Worker, така че покрива и workers.dev адреса, и собствен домейн, ако добавиш такъв.

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
