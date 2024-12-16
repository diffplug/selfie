╔═ test_login_flow/1. not logged in ═╗
<html>
 <body>
  <h1>
   Please login
  </h1>
  <form action="/login" method="post">
   <input name="email" placeholder="email" type="text"/>
   <input type="submit" value="login"/>
  </form>
 </body>
</html>

╔═ test_login_flow/1. not logged in[md] ═╗
Please login
╔═ test_login_flow/1. not logged in[status] ═╗
200 OK
╔═ test_login_flow/2. post login form ═╗
<html>
 <body>
  <h1>
   Email sent!
  </h1>
  <p>
   Check your email for your login link.
  </p>
 </body>
</html>

╔═ test_login_flow/2. post login form[md] ═╗
Email sent!

Check your email for your login link.
╔═ test_login_flow/2. post login form[status] ═╗
200 OK
╔═ test_login_flow/3. log in works with cookies ═╗
<html>
 <body>
  <h1>
   Welcome back user@domain.com
  </h1>
 </body>
</html>

╔═ test_login_flow/3. log in works with cookies[md] ═╗
Welcome back user@domain.com
╔═ test_login_flow/3. log in works with cookies[status] ═╗
200 OK
╔═ test_login_flow/4. log in fails with fake cookies ═╗
<!DOCTYPE html>
<html lang="en">
 <title>
  401 Unauthorized
 </title>
 <h1>
  Unauthorized
 </h1>
 <p>
  The server could not verify that you are authorized to access the URL requested. You either supplied the wrong credentials (e.g. a bad password), or your browser doesn't understand how to supply the credentials required.
 </p>
</html>

╔═ test_login_flow/4. log in fails with fake cookies[md] ═╗
401 Unauthorized

Unauthorized

The server could not verify that you are authorized to access the URL requested. You either supplied the wrong credentials (e.g. a bad password), or your browser doesn't understand how to supply the credentials required.
╔═ test_login_flow/4. log in fails with fake cookies[status] ═╗
401 UNAUTHORIZED
╔═ [end of file] ═╗
