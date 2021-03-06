module.exports = function (doc) {
  const cheerio = require('cheerio');
  const _ = require('lodash');

  // https://github.com/cheeriojs/cheerio/issues/866#issuecomment-482730997
  const load = cheerio.load;

  function decode(string) {
    return string.replace(/&#x([0-9a-f]{1,6});/ig, (entity, code) => {
      code = parseInt(code, 16);

      // Don't unescape ASCII characters, assuming they're encoded for a good reason
      if (code < 0x80) return entity;

      return String.fromCodePoint(code);
    });
  }

  function wrapHtml(fn) {
    return function () {
      const result = fn.apply(this, arguments);
      return typeof result === 'string' ? decode(result) : result;
    };
  }

  cheerio.load = function () {
    const instance = load.apply(this, arguments);

    instance.html = wrapHtml(instance.html);
    instance.prototype.html = wrapHtml(instance.prototype.html);

    return instance;
  };

  var $ = cheerio.load(doc.content);

  // cheerio seems to be wrapping input in <html><body></body></html>
  // console.log($.html());

  // wrap top level in a scope
  /*
  // why this does not work
  const topLevelScope = $("<div class=\"fnScope\"></div>");
  $("html>body").each((_, elem) => {
    elem.parentNode = topLevelScope.get(0);
  })
  topLevelScope.get(0).parentNode = $("html>body").get(0);
  */
  $("html>body").html(
    $("<div class='fnScope'></div>").html(
      // cheerio puts things in <head></head>
      // move them back to body
      $("html>head").children()
        .map((_, elem) =>
          $.html($(elem)))
        .get()
        .join("") +
      $("html>body").children()
        .map((_, elem) =>
          $.html($(elem)))
        .get()
        .join("")
    ));

  // console.log($.html());

  function forChildren(node, action) {
    return node.children().map((_, child) => action($(child))).get()
  }

  var nFn = 1;
  footnoteSection = null;

  function doFnSection(sec) {
    sec.remove();
    if (!footnoteSection) {
      footnoteSection = sec;
    }
    else {
      sec.find(":root>ol>li").each((_, li) => {
        //console.log("=====li=====");
        //console.log(li.html());

        footnoteSection.find(":root>ol").append(li);
      });
    }
  }

  function doScopeDiv(div) {
    parent = div.parent().closest("div.fnScope");
    scope = parent.attr("scope");
    if (scope) scope += ".";
    else scope = "";
    nth = parent.attr("nth");
    nth = parseInt(nth);
    if (!nth) nth = 1;
    else nth += 1;
    parent.attr("nth", nth);
    scope += nth;

    div.attr("scope", scope);
  }

  function fixFootnotes(node) {
    if (node.is("div.fnScope")) {
      // pre order
      doScopeDiv(node);
      forChildren(node, (node) => fixFootnotes(node));

      // console.log("=====div.fnScope=====");
      // console.log("scope", node.attr("scope"));
      // parent = node.parent().closest("div.fnScope");
      // console.log('parent nth', parent.attr("nth"));
      // console.log(node.html());

    } else if (node.is("section.footnotes")) {
      // post order
      forChildren(node, (node) => fixFootnotes(node));

      // console.log("=====footnotes section=====");
      // console.log(node.html());

      doFnSection(node);

    } else if (node.is("div.tippy-tooltip")) {
      scope = node.closest("div.fnScope").attr("scope");
      if (!scope) scope = "";
      else scope = "-" + scope;

      node.attr("id", node.attr("id") + scope);

    } else if (node.is("a.footnote-ref")) {
      scope = node.closest("div.fnScope").attr("scope");
      if (!scope) scope = "";
      else scope = "-" + scope;

      node.find("sup").text(nFn++);
      node.attr("id", node.attr("id") + scope);
      node.attr("href", node.attr("href") + scope);

    } else if (node.is("li[role=doc-endnote]")) {
      let section = node.closest("section.footnotes");
      let scope = (
        // we wrapped nunjucks block in div
        // then pandoc appended footnote section
        section.prev('div.fnScope').attr("scope")
        // for top level
        // because we wrapped footnote section
        // also in the div
        || section.closest('div.fnScope').attr("scope"));

      // console.log("=====doc-endnote=====");
      // console.log("div", scope);

      if (!scope) scope = "";
      else scope = "-" + scope;

      // console.log("scope", scope);

      node.attr("id", node.attr("id") + scope);

      node.find("a.footnote-back").each((_, node) => {
        node = $(node);
        node.attr("href", node.attr("href") + scope);
      });

    } else {
      forChildren(node, (node) => fixFootnotes(node));
    }
  }

  fixFootnotes($("html>body"));

  if (footnoteSection) {
    order = _($("html>body a.footnote-ref").toArray())
      .map((ref) => ref.attribs.href)
      .map((id, idx) => ({[id]: idx}))
      .thru(_.spread(_.partial(_.assign, {})))
      .value();

    _(footnoteSection
      .find('li[role=doc-endnote]')
      .toArray())
      .tap(note => note.remove)
      .map(note => [note, order['#' + note.attribs.id]])
      .sortBy(i => i[1])
      .map(i => i[0])
      .forEach(i => footnoteSection.find('ol').append(i));

    // console.log(footnoteSection.html());
    $("html>body").append(footnoteSection);
  }

  doc.content = $("html>body").html();
  //doc.content = $.html();

  // console.log("=====modified=====");
  // console.log(doc.content);
}