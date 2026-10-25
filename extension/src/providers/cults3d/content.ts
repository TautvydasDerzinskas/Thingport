// What a Cults3D page shows of the signed-in user and of the model, read from the page itself.

/** Links only a signed-in user's pages have: their own designs, messages and profile settings. A visitor gets a
 *  session cookie too, and sending that on would replace a working sign-in with one that isn't. */
export function cults3dSignedIn(): boolean {
  return Boolean(
    document.querySelector('a[href$="/creations/mine"], a[href$="/my-messages"], a[href$="/profile/edit"]'),
  );
}

/** A paid model the user hasn't bought: its button puts it in the cart, and the page has no download of it. A bought
 *  one comes from the user's downloads, so it imports like a free one. */
export function isUnboughtCults3dModel(): boolean {
  const addsToCart = Boolean(document.querySelector('form[action*="/lines?creation_id="]'));
  const downloads = Boolean(
    document.querySelector('form[action*="/free_orders?"], a[href*="/downloads/"], a[href*="/orders/"]'),
  );
  return addsToCart && !downloads;
}
