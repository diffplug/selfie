# spotless-snapshot

- Snapshot testing for the JVM and Javascript.
- Supports text and binary data.
- Version-control friendly.
- Supports lenses to verify multiple aspects of an object under test.

For example, here is a very simple test which snapshots the HTML served at various URLs. 

```
@Test
public void homepage(Expect expect) {
  expect.toMatchSnapshot(get("localhost:8080/"))
}

@Test
public void orderFlow(Expect expect) {
  expect.scenario("initial").toMatchSnapshot(get("localhost:8080/orders"));
  postOrder();
  expect.scenario("ordered").toMatchSnapshot(get("localhost:8080/orders"));
}
```

This will generate a snapshot file like so:

```
╔═ homepage ═╗
<html><head>
  (etc)
</html>
╔═ orderFlow/initial ═╗
<html><head>
  (etc)
</html>
╔═ orderFlow/ordered ═╗
<html><head>
  (etc)
</html>
```
