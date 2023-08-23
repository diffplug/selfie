# Selfie

- Precise snapshot testing for the JVM and Javascript (others TBD)
- Supports text and binary data.
- Friendly to humans and version control.
- In-place [literal snapshots](#literal-snapshots).
- Allows [lenses](#lenses) to verify multiple aspects of an object under test.
  - e.g. pretty-printed JSON, or only the rendered plaintext of an HTML document, etc.

ere is a very simple test which snapshots the HTML served at various URLs.

```java
@Test public void gzipFavicon() {
    expectSelfie(get("/favicon.ico", ContentEncoding.GZIP)).toMatchDisk();
}
@Test public void orderFlow() {
  expectSelfie(get("/orders")).toMatchDisk("initial");
  postOrder();
  expectSelfie(get("/orders")).toMatchDisk("ordered");
}
```

This will generate a snapshot file like so:

```
╔═ gzipFavicon ═╗ base64 length 823 bytes
H4sIAAAAAAAA/8pIzcnJVyjPL8pJUQQAlQYXAAAA
╔═ orderFlow/initial ═╗
<html><body>
  <button>Submit order</button>
</body></html>
╔═ orderFlow/ordered ═╗
<html><body>
  <p>Thanks for your business!</p>
  <details>
    <summary>Order information</summary>
    <p>Tracking #ABC123</p>
  </details>
</body></html>
```

### Literal snapshots

A great thing about snapshots is that they are fast to write and update. A downside is that the asserted value is opaque. But it doesn't have to be! Just swap `toMatchDisk` for `toBe`.

```java
@Test public void preventCssBloat() {
  //        selfie can update this literal value for you ▼
  int size = expectSelfie(get("/index.css").length).toBe(5_236);
  if (size > 100_000) {
    Assert.fail("CSS has gotten too big!");
  }
}
```

Now we can see at a glance how a PR has affected the bundled size of our CSS. We can easily automate manual processes and turn "test execution time" values into source code constants, without wasting programmer time on fragile manual workflows.

### Lenses

When snapshotting HTML, you might want to look at only the rendered text, ignoring tags, classes, and all that.

```java
public SelfieConfig extends com.diffplug.selfie.SelfieConfig {
  @Override public @Nullable Snapshot intercept(Class<?> className, String testName, Snapshot snapshot) {
    if (!snapshot.getValue().isBinary()) {
      String content = snapshot.getValue().valueString();
      if (content.contains("<html>")) {
        return snapshot.lens("plaintext", Jsoup.parse(content).text());
      }
    }
    return null;
  }
}
```

Now we'll get a snapshot file like so:

```
╔═ orderFlow/ordered ═╗
<html><body>
  <p>Thanks for your business!</p>
  <details>
    <summary>Order information</summary>
    <p>Tracking #ABC123</p>
  </details>
</body></html>
╔═ orderFlow/ordered[plaintext] ═╗
Thanks for your business!
Order information
Tracking #ABC123
```

Lenses can make PRs easier to review, by putting the focus on whichever aspect of the snapshot is relevant to the change.

### Acknowledgements

- Heavily inspired by [origin-energy's java-snapshot-testing](https://github.com/origin-energy/java-snapshot-testing).
- Which in turn is heavily inspired by [Facebook's jest-snapshot](https://jestjs.io/docs/snapshot-testing).
