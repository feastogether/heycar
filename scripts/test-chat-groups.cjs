const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  { stripTypeScriptTypes } = require("node:module");
const path = require("node:path"),
  root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const backend = stripTypeScriptTypes(
  fs.readFileSync(
    path.join(root, "supabase/functions/data-api/index.ts"),
    "utf8",
  ),
);
function source(code, name) {
  const start = code.indexOf(`function ${name}(`);
  assert(start >= 0, name);
  const rest = code.slice(start);
  const next = rest.slice(1).search(/\n(?:  )?(?:async )?function /);
  return rest.slice(0, next < 0 ? undefined : next + 1);
}
async function main() {
  const group = "11111111-1111-4111-8111-111111111111",
    secret = "22222222-2222-4222-8222-222222222222";
  const rows = {
    admin_users: [{ id: "amy", active: true }],
    admin_chat_group_members: [{ group_id: group, user_id: "me" }],
    admin_chat_group_messages: Array.from({ length: 105 }, (_, i) => ({
      id: "m" + i,
      seq: i + 1,
      group_id: group,
      sender_id: "amy",
      message: "hello",
    })),
  };
  const calls = [];
  const db = {
    from(table) {
      let filters = [],
        inserted,
        desc = false,
        max = 10000;
      return {
        select() {
          return this;
        },
        eq(k, v) {
          filters.push((row) => row[k] === v);
          return this;
        },
        in(k, v) {
          filters.push((row) => v.includes(row[k]));
          return this;
        },
        lt(k, v) {
          filters.push((row) => row[k] < v);
          return this;
        },
        order(k, opts) {
          desc = opts.ascending === false;
          return this;
        },
        limit(n) {
          max = n;
          return this;
        },
        insert(row) {
          inserted = { id: "new", seq: 106, ...row };
          rows[table].push(inserted);
          return this;
        },
        single() {
          return Promise.resolve({ data: inserted, error: null });
        },
        maybeSingle() {
          return Promise.resolve({
            data:
              (rows[table] || []).find((r) => filters.every((f) => f(r))) ||
              null,
            error: null,
          });
        },
        then(resolve, reject) {
          let data = (rows[table] || []).filter((r) =>
            filters.every((f) => f(r)),
          );
          if (desc) data = data.sort((a, b) => b.seq - a.seq);
          return Promise.resolve({
            data: data.slice(0, max),
            error: null,
          }).then(resolve, reject);
        },
      };
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: group, error: null };
    },
  };
  const ctx = vm.createContext({
    db,
    Set,
    Number,
    compactText: (value) => String(value || "").trim(),
    json: (value, status = 200) => ({ value, status }),
  });
  for (const name of [
    "requireAdminGroupMember",
    "loadAdminGroupMessages",
    "handleAdminGroupChat",
  ])
    vm.runInContext("async " + source(backend, name), ctx);
  const session = {
    session_type: "admin",
    admin_user_id: "me",
    admin_name: "本人",
  };
  for (const action of [
    "send_admin_group_message",
    "load_admin_group_messages",
    "mark_admin_group_read",
  ]) {
    const result = await ctx.handleAdminGroupChat(
      { action, group_id: secret, message: "no" },
      session,
    );
    assert.equal(result.status, 403, action + " rejects nonmember");
    assert.equal(
      (
        await ctx.handleAdminGroupChat(
          { action, group_id: group },
          { session_type: "driver" },
        )
      ).status,
      403,
    );
  }
  const sent = await ctx.handleAdminGroupChat(
    {
      action: "send_admin_group_message",
      group_id: group,
      message: "團隊討論",
      sender_id: "forged",
    },
    session,
  );
  assert.equal(sent.value.data.sender_id, "me");
  assert.equal(sent.value.data.sender_name, "本人");
  const history = await ctx.handleAdminGroupChat(
    { action: "load_admin_group_messages", group_id: group },
    session,
  );
  assert.equal(history.value.messages.length, 100);
  assert.equal(history.value.has_more, true);
  assert(history.value.messages[0].seq < history.value.messages[99].seq);
  const older = await ctx.handleAdminGroupChat(
    { action: "load_admin_group_messages", group_id: group, before_seq: 7 },
    session,
  );
  assert.equal(older.value.messages.length, 6);
  assert.equal(older.value.has_more, false);
  assert.equal(
    (
      await ctx.handleAdminGroupChat(
        {
          action: "send_admin_group_message",
          group_id: group,
          message: "x".repeat(2001),
        },
        session,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await ctx.handleAdminGroupChat(
        {
          action: "create_admin_chat_group",
          name: "群組",
          member_ids: ["stranger"],
        },
        session,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await ctx.handleAdminGroupChat(
        { action: "create_admin_chat_group", name: "", member_ids: ["amy"] },
        session,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await ctx.handleAdminGroupChat(
        {
          action: "create_admin_chat_group",
          name: "群組",
          member_ids: ["amy", "me", "amy"],
        },
        session,
      )
    ).status,
    200,
  );
  assert.equal(calls.at(-1).args.p_creator_id, "me");
  assert.deepEqual(Array.from(calls.at(-1).args.p_member_ids), ["amy"]);
  await ctx.handleAdminGroupChat(
    { action: "mark_admin_group_read", group_id: group, through_seq: 42 },
    session,
  );
  assert.equal(calls.at(-1).args.p_through_seq, 42);
  assert.equal(calls.at(-1).args.p_user_id, "me");
  const state = {
    adminProfile: { id: "me" },
    data: {
      admin_users: [{ id: "amy", name: "同事" }],
      admin_chat_messages: [],
      admin_chat_groups: [
        {
          id: group,
          name: "調度群",
          member_ids: ["me", "amy"],
          unread_count: 2,
          last_message: {
            seq: 2,
            message: "新群組訊息",
            created_at: "2026-10-24T10:00:00Z",
          },
        },
      ],
      admin_chat_group_messages: [
        {
          id: "g1",
          group_id: group,
          seq: 2,
          sender_id: "amy",
          message: "<script>bad</script>",
        },
      ],
    },
    adminChatContactId: "group:" + group,
  };
  const front = vm.createContext({
    state,
    Date,
    Map,
    Number,
    hasApi: true,
    apiRequest: async (action, body) => calls.push({ action, body }),
    now: () => "",
    escapeHtml: (value) =>
      String(value || "")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;"),
    staffAvatar: () => "",
    iconSvg: () => "",
    formatDateTime: () => "",
  });
  state.apiSession = "session";
  for (const name of [
    "currentAdminChatId",
    "adminChatSummary",
    "adminChatContacts",
    "adminChatAvatar",
    "adminChatContactName",
    "adminChatCurrentMarkup",
    "adminChatMessages",
    "adminChatMessagesMarkup",
    "adminChatContactPreview",
    "adminChatContactUnread",
    "adminChatContactsMarkup",
    "adminUnreadChatCount",
  ])
    vm.runInContext(source(app, name), front);
  vm.runInContext("async " + source(app, "markAdminChatRead"), front);
  assert.equal(front.adminChatContacts()[0].id, "group:" + group);
  assert.equal(front.adminUnreadChatCount(), 2);
  assert.equal(front.adminChatMessages("amy").length, 0);
  assert(front.adminChatCurrentMarkup().includes("成員 2"));
  assert(front.adminChatMessagesMarkup().includes("&lt;script&gt;"));
  assert(front.adminChatContactsMarkup().includes("新群組訊息"));
  await front.markAdminChatRead();
  assert.equal(calls.at(-1).body.through_seq, 2);
  assert.equal(front.adminUnreadChatCount(), 0);
  console.log(
    "PASS: group membership access, session-owned senders, validation, bounded history, group ordering, escaped messages and read acknowledgements",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
