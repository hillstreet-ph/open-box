import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  ASSISTANT_WIDGET,
  installManagementNavigation,
} from "../src/assistant-widget.js";

const nativeMenu = `<nav><a href="/@manage">Profile</a><a href="/@manage/storages" class="hope-anchor active" aria-current="page"><svg viewBox="0 0 24 24"></svg><h2 class="hope-heading">Storages</h2></a><a href="/@manage/shares">Shares</a></nav>`;
const rowSelector = "a[data-open-box-integrations]";

function fixture(t, body, path = "/@manage/storages") {
  const { document, window } = parseHTML(`<html><body>${body}</body></html>`);
  const location = { pathname: path };
  const fallback = document.createElement("a");
  fallback.hidden = false;
  const navigation = installManagementNavigation(
    document,
    location,
    fallback,
    window.MutationObserver,
  );
  t.after(() => navigation.observer.disconnect());
  return { document, location, fallback, navigation };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("Integrations follows Storages in both desktop and mobile menus", async (t) => {
  const { document, fallback, navigation } = fixture(
    t,
    nativeMenu + nativeMenu,
  );
  navigation.sync();
  await settle();
  const rows = [...document.querySelectorAll(rowSelector)];
  assert.equal(rows.length, 2);
  assert.equal(fallback.hidden, true);
  for (const row of rows) {
    assert.equal(row.previousElementSibling.textContent, "Storages");
    assert.equal(row.nextElementSibling.textContent, "Shares");
    assert.equal(row.textContent, "Integrations");
    assert.equal(row.getAttribute("href"), "/settings/integrations");
    assert.equal(row.hasAttribute("aria-current"), false);
    assert.equal(row.classList.contains("active"), false);
    assert.equal(row.classList.contains("hope-anchor"), true);
    assert.equal(row.querySelector("h2").className, "hope-heading");
    assert.equal(row.querySelector("svg").getAttribute("aria-hidden"), "true");
  }
});

test("menu loading, remounts and file navigation retain exactly one access path", async (t) => {
  const { document, fallback, location, navigation } = fixture(t, "");
  assert.equal(fallback.hidden, false);
  document.body.innerHTML = nativeMenu;
  await settle();
  assert.equal(document.querySelectorAll(rowSelector).length, 1);
  assert.equal(fallback.hidden, true);
  document.body.innerHTML = nativeMenu;
  await settle();
  assert.equal(document.querySelectorAll(rowSelector).length, 1);
  location.pathname = "/Workspace";
  navigation.sync();
  await settle();
  assert.equal(document.querySelectorAll(rowSelector).length, 0);
  assert.equal(fallback.hidden, false);
  location.pathname = "/@manage/users";
  navigation.sync();
  await settle();
  assert.equal(document.querySelectorAll(rowSelector).length, 1);
  assert.equal(fallback.hidden, true);
});

test("unrelated storage links and lookalike routes do not suppress the fallback", (t) => {
  const unrelated = '<p><a href="/@manage/storages">View storage</a></p>';
  const { document, fallback } = fixture(t, unrelated);
  assert.equal(document.querySelectorAll(rowSelector).length, 0);
  assert.equal(fallback.hidden, false);
  const lookalike = fixture(t, nativeMenu, "/@management");
  assert.equal(lookalike.document.querySelectorAll(rowSelector).length, 0);
  assert.equal(lookalike.fallback.hidden, false);
});

test("the shipped widget keeps Assistant available without a duplicate floating Integrations link", () => {
  const { document, window } = parseHTML(
    `<html><body>${nativeMenu}</body></html>`,
  );
  const run = new Function(
    "document",
    "window",
    "location",
    "MutationObserver",
    "localStorage",
    ASSISTANT_WIDGET,
  );
  const args = [
    document,
    window,
    { pathname: "/@manage" },
    window.MutationObserver,
    { getItem: () => null },
  ];
  run(...args);
  run(...args);
  assert.equal(document.querySelectorAll(rowSelector).length, 1);
  assert.equal(
    document.querySelectorAll("#open-box-agent-assistant").length,
    1,
  );
  const root = document.getElementById("open-box-agent-assistant").shadowRoot;
  assert.equal(root.querySelector(".dock a").hidden, true);
  assert.equal(
    root.querySelector(".launcher").getAttribute("aria-label"),
    "Open Agent Assistant",
  );
  assert.equal(root.querySelector(".panel").hidden, true);
});
