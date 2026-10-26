#!/usr/bin/env bash
# Builds a fictional repository ("acme-shop") with a realistic history for screenshots and demos:
# several authors, main/develop, feature branches merged back, a release branch, a hotfix, tags,
# uncommitted changes and a stash. Usage: scripts/demo-repo.sh <dir>   (the directory is replaced)
set -euo pipefail
DIR=${1:?usage: demo-repo.sh <dir> [--conflict]}
MODE=${2:-}
rm -rf "$DIR" && mkdir -p "$DIR" && cd "$DIR"
git init -q -b main
git config user.name "Demo" && git config user.email "demo@example.com"

T=$(date -v-40d +%s 2>/dev/null || date -d '40 days ago' +%s)
as() { # as "<name>" <email> <message> [files...]: commit as an author, one step later in time
  local name=$1 email=$2 msg=$3; shift 3
  T=$((T + 3600 * 7))
  for f in "$@"; do mkdir -p "$(dirname "$f")"; printf '%s\n' "// $msg" >> "$f"; done
  git add -A
  GIT_AUTHOR_NAME="$name" GIT_AUTHOR_EMAIL="$email" GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email" \
    GIT_AUTHOR_DATE="@$T" GIT_COMMITTER_DATE="@$T" git commit -q -m "$msg"
}
merge() { # merge <branch> "<message>" as Linh
  T=$((T + 3600 * 3))
  GIT_AUTHOR_NAME="Linh Tran" GIT_AUTHOR_EMAIL=linh@acme.dev GIT_COMMITTER_NAME="Linh Tran" GIT_COMMITTER_EMAIL=linh@acme.dev \
    GIT_AUTHOR_DATE="@$T" GIT_COMMITTER_DATE="@$T" git merge -q --no-ff "$1" -m "$2"
}
A=("Linh Tran" linh@acme.dev) B=("Minh Nguyen" minh@acme.dev) C=("Sarah Kim" sarah@acme.dev) D=("Tuan Pham" tuan@acme.dev)

as "${A[@]}" "chore: initialise acme-shop" README.md package.json
as "${A[@]}" "feat(api): product catalogue endpoints" src/api/products.ts
as "${B[@]}" "feat(ui): product list page" src/ui/ProductList.tsx
git tag -a v1.0.0 -m "First release"
git checkout -q -b develop
as "${C[@]}" "feat(auth): email + password sign in" src/auth/login.ts
git checkout -q -b feature/cart develop
mkdir -p src/cart && cat > src/cart/cart.ts <<'TS'
export interface CartItem {
  sku: string;
  price: number;
  qty: number;
}

export function addToCart(cart: CartItem[], sku: string, price: number): CartItem[] {
  const found = cart.find((i) => i.sku === sku);
  if (found) found.qty += 1;
  else cart.push({ sku, price, qty: 1 });
  return cart;
}

export function total(cart: CartItem[]): number {
  let sum = 0;
  for (const item of cart) sum += item.price * item.qty;
  return sum;
}
TS
as "${B[@]}" "feat(cart): add to cart"
cat > src/cart/cart.ts <<'TS'
export interface CartItem {
  sku: string;
  price: number;
  qty: number;
}

export interface Discount {
  code: string;
  percent: number;
}

export function addToCart(cart: CartItem[], sku: string, price: number, qty = 1): CartItem[] {
  const found = cart.find((i) => i.sku === sku);
  if (found) found.qty += qty;
  else cart.push({ sku, price, qty });
  return cart;
}

export function subtotal(cart: CartItem[]): number {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function total(cart: CartItem[], discount?: Discount): number {
  const sum = subtotal(cart);
  if (!discount) return sum;
  return Math.round(sum * (100 - discount.percent)) / 100;
}
TS
as "${B[@]}" "feat(cart): quantity stepper and discount codes" src/ui/Cart.tsx
git checkout -q develop
as "${D[@]}" "fix(api): paginate products" src/api/products.ts
git checkout -q -b feature/search develop
as "${C[@]}" "feat(search): full-text product search" src/search/index.ts
git checkout -q feature/cart
as "${B[@]}" "test(cart): totals and discounts" test/cart.test.ts
git checkout -q develop
merge feature/cart "Merge branch 'feature/cart' into develop"
git checkout -q feature/search
as "${C[@]}" "feat(search): highlight matches" src/ui/SearchResults.tsx
git checkout -q develop
as "${D[@]}" "refactor(api): shared error handler" src/api/errors.ts
merge feature/search "Merge branch 'feature/search' into develop"
git checkout -q -b release/1.1 develop
as "${A[@]}" "chore(release): 1.1.0" package.json CHANGELOG.md
git checkout -q main
merge release/1.1 "Merge branch 'release/1.1'"
git tag -a v1.1.0 -m "Cart and search"
git checkout -q develop
merge main "Merge branch 'main' into develop"
git checkout -q -b hotfix/login-redirect main
as "${C[@]}" "fix(auth): redirect after sign in" src/auth/login.ts
git checkout -q main
merge hotfix/login-redirect "Merge branch 'hotfix/login-redirect'"
git tag -a v1.1.1 -m "Login redirect fix"
git checkout -q develop
merge main "Merge branch 'main' into develop"
git checkout -q -b feature/checkout develop
as "${D[@]}" "feat(checkout): address form" src/checkout/Address.tsx
as "${D[@]}" "feat(checkout): payment step" src/checkout/Payment.tsx
git checkout -q -b feature/wishlist develop
as "${B[@]}" "feat(wishlist): save items for later" src/wishlist/index.ts
git checkout -q develop
as "${A[@]}" "docs: contributing guide" CONTRIBUTING.md
git checkout -q feature/checkout
as "${D[@]}" "feat(checkout): order summary" src/checkout/Summary.tsx
git checkout -q feature/wishlist
as "${B[@]}" "feat(wishlist): share wishlist link" src/wishlist/share.ts
git checkout -q develop
merge feature/wishlist "Merge branch 'feature/wishlist' into develop"
as "${C[@]}" "perf(ui): lazy-load product images" src/ui/ProductList.tsx
git checkout -q feature/checkout

if [ "$MODE" = "--conflict" ]; then
  # Two branches change the same lines of the cart: merging leaves conflicts for the merge tool.
  git checkout -q develop
  sed -i.bak 's/return Math.round(sum \* (100 - discount.percent)) \/ 100;/return Math.max(0, sum - (sum * discount.percent) \/ 100);/' src/cart/cart.ts && rm -f src/cart/cart.ts.bak
  as "${D[@]}" "fix(cart): never return a negative total"
  git checkout -q -b feature/coupons develop~1
  sed -i.bak 's/return Math.round(sum \* (100 - discount.percent)) \/ 100;/return Number((sum * (1 - discount.percent \/ 100)).toFixed(2));/' src/cart/cart.ts && rm -f src/cart/cart.ts.bak
  as "${C[@]}" "feat(coupons): two-decimal rounding for coupons"
  git checkout -q develop
  git merge feature/coupons -m "Merge branch 'feature/coupons' into develop" >/dev/null 2>&1 || true
  echo "Demo repository with a merge conflict ready: $DIR"
  exit 0
fi

# A stash and some work in progress, so the graph shows the WIP node and a stash.
printf 'export const TAX = 0.1;\n' > src/checkout/tax.ts && git add src/checkout/tax.ts
git stash push -q -m "WIP: tax rules"
printf '// TODO: validate card number\n' >> src/checkout/Payment.tsx
printf '// shipping options\n' >> src/checkout/Address.tsx
printf 'export const shipping = [];\n' > src/checkout/shipping.ts
git add src/checkout/Address.tsx
echo "Demo repository ready: $DIR"
