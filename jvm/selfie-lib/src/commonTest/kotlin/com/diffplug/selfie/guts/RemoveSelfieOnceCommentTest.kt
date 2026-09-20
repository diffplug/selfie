/*
 * Copyright (C) 2025 DiffPlug
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.diffplug.selfie.guts

import io.kotest.matchers.shouldBe
import kotlin.test.Test

class RemoveSelfieOnceCommentTest {
  private val tripleQuote = "\"\"\""

  @Test
  fun `"qwerty" should return self`() {
    verifyUnchanged("qwerty")
  }

  @Test
  fun `simple selfieonce comment should return empty`() {
    RemoveSelfieOnceComment.removeSelfieComment("//selfieonce") shouldBe ""
  }

  @Test
  fun `selfie once with space should return unchanged`() {
    verifyUnchanged("//selfie once")
  }

  @Test
  fun `empty string should return empty`() {
    verifyUnchanged("")
  }

  @Test
  fun `multiple selfieonce comments on same line should return unchanged`() {
    verifyUnchanged("//selfieonce//selfieonce")
  }

  @Test
  fun `slash space selfieonce should return unchanged`() {
    verifyUnchanged("/ /selfieonce")
  }

  @Test
  fun `single slash selfieonce should return unchanged`() {
    verifyUnchanged("/selfieonce")
  }

  @Test
  fun `selfieonce with spaces between characters should return unchanged`() {
    verifyUnchanged("//s e l f i e o n c e")
  }

  @Test
  fun `whitespace only should return unchanged`() {
    verifyUnchanged("  ")
  }

  @Test
  fun `multiline whitespace should return unchanged`() {
    verifyUnchanged("""

            """)
  }

  @Test
  fun `selfieonce with newline should preserve newline`() {
    RemoveSelfieOnceComment.removeSelfieComment("//selfieonce\n") shouldBe "\n"
  }

  @Test
  fun `should not change when enclosed into outer comment`() {
    verifyUnchanged("var s = \"//\"; // abc \"\"\" //selfieonce")
  }

  @Test
  fun `selfieonce alone should return empty`() {
    RemoveSelfieOnceComment.removeSelfieComment("//selfieonce") shouldBe ""
  }

  @Test
  fun `selfieonce with number should return unchanged`() {
    verifyUnchanged("//selfieonce1")
  }

  @Test
  fun `selfieonce with trailing spaces should return empty`() {
    RemoveSelfieOnceComment.removeSelfieComment("//selfieonce         ") shouldBe ""
  }

  @Test
  fun `should remove all selfieonce when multiple selfieonce on separate lines`() {
    RemoveSelfieOnceComment.removeSelfieComment("//selfieonce\n//selfieonce") shouldBe "\n"
  }

  @Test
  fun `selfieonce with leading spaces should be removed completely`() {
    RemoveSelfieOnceComment.removeSelfieComment("    //selfieonce") shouldBe ""
  }

  @Test
  fun `selfieonce with spaces around should trim to empty`() {
    RemoveSelfieOnceComment.removeSelfieComment("     //     selfieonce         ") shouldBe ""
  }

  @Test
  fun `selfieonce with newlines around should preserve newlines`() {
    RemoveSelfieOnceComment.removeSelfieComment("\n//selfieonce\n") shouldBe "\n\n"
  }

  @Test
  fun `selfieonce with mixed newlines should preserve newlines`() {
    RemoveSelfieOnceComment.removeSelfieComment("\n//selfieonce\r") shouldBe "\n\r"
  }

  @Test
  fun `selfieonce with CRLF should preserve CRLF`() {
    RemoveSelfieOnceComment.removeSelfieComment("\r\n//selfieonce\r\n") shouldBe "\r\n\r\n"
  }

  @Test
  fun `selfieonce in triple quote should return unchanged`() {
    verifyUnchanged("""
            ${tripleQuote}
            //selfieonce
        """)
  }

  @Test
  fun `selfieonce after triple quote should be removed`() {
    val input =
        """
            ${tripleQuote}
            //selfieonce
            ${tripleQuote}
            //selfieonce
        """
    val expected =
        """
            ${tripleQuote}
            //selfieonce
            ${tripleQuote}

        """
    RemoveSelfieOnceComment.removeSelfieComment(input) shouldBe expected
  }

  @Test
  fun `selfieonce between triple quotes should be removed`() {
    val input =
        """
            ${tripleQuote}
            ${tripleQuote}
            //selfieonce
            ${tripleQuote}
            //selfieonce
        """
    val expected =
        """
            ${tripleQuote}
            ${tripleQuote}

            ${tripleQuote}
            //selfieonce
        """
    RemoveSelfieOnceComment.removeSelfieComment(input) shouldBe expected
  }

  @Test
  fun `selfieonce in block comment should return unchanged`() {
    verifyUnchanged("/* //selfieonce */")
  }

  @Test
  fun `selfieonce inside simple string should return unchanged`() {
    verifyUnchanged("\"//selfieonce\"")
  }

  @Test
  fun `selfieonce inside simple string assignment should return unchanged`() {
    verifyUnchanged("var string = \"//selfieonce\";")
  }

  @Test
  fun `selfieonce after inline block comment should be removed`() {
    RemoveSelfieOnceComment.removeSelfieComment("/**/ //selfieonce") shouldBe "/**/"
  }

  @Test
  fun `selfieonce after inline javadoc comment should be removed`() {
    RemoveSelfieOnceComment.removeSelfieComment("/***/ //selfieonce") shouldBe "/***/"
  }

  @Test
  fun `selfieonce in block comment with text should return unchanged`() {
    verifyUnchanged("/* comment with //selfieonce inside */")
  }

  @Test
  fun `selfieonce in triple quote literal should return unchanged`() {
    verifyUnchanged("${tripleQuote}//selfieonce${tripleQuote}")
  }

  @Test
  fun `selfieonce in string literal should return unchanged`() {
    verifyUnchanged("\"//selfieonce\"")
  }

  @Test
  fun `multiple selfieonce comments on different lines should remove all`() {
    val input =
        """
            //selfieonce
            code line
            //selfieonce
            """
    val expected = """

            code line

            """
    RemoveSelfieOnceComment.removeSelfieComment(input) shouldBe expected
  }

  @Test
  fun `selfieonce with code before should preserve code`() {
    RemoveSelfieOnceComment.removeSelfieComment("val x = 5 //selfieonce") shouldBe "val x = 5"
  }

  @Test
  fun `selfieonce with space after slashes should preserve code`() {
    RemoveSelfieOnceComment.removeSelfieComment("val x = 5 // selfieonce") shouldBe "val x = 5"
  }

  @Test
  fun `selfieonce with spaces around should preserve code`() {
    RemoveSelfieOnceComment.removeSelfieComment("val x = 5 //  selfieonce  ") shouldBe "val x = 5"
  }

  @Test
  fun `selfieonce with CR and LF should preserve newlines`() {
    RemoveSelfieOnceComment.removeSelfieComment("\r//selfieonce\n") shouldBe "\r\n"
  }

  @Test
  fun `selfieonce with multiple CRLF should preserve all newlines`() {
    RemoveSelfieOnceComment.removeSelfieComment("\r\n\r\n//selfieonce\r\n") shouldBe "\r\n\r\n\r\n"
  }

  @Test
  fun `selfieonce with special characters should return unchanged`() {
    verifyUnchanged("//selfieonce$%^&*")
  }

  @Test
  fun `selfieonce with underscores should return unchanged`() {
    verifyUnchanged("//selfieonce_with_underscores")
  }

  @Test
  fun `selfieonce in nested block comments should return unchanged`() {
    verifyUnchanged("/* outer /* inner //selfieonce */ */")
  }

  @Test
  fun `when selfieonce is present inside triple quote string which is in comment then ignore`() {
    verifyUnchanged(
        """
      /**
${tripleQuote}
//selfieonce
${tripleQuote}
//selfieonce
${tripleQuote}
//selfieonce
${tripleQuote}
//selfieonce
//selfieonce
      *
    """
            .trimIndent())
  }

  @Test
  fun `when selfieonce is present inside comment which is in triple quote string then ignore`() {
    verifyUnchanged(
        """
${tripleQuote}
//selfieonce
/*
//selfieonce
//selfieonce
*/
${tripleQuote}
    """
            .trimIndent())
  }

  @Test
  fun `selfieonce after nested triple quotes should be removed`() {
    val input =
        """
            ${tripleQuote}
            ${tripleQuote}${tripleQuote}
            //selfieonce
            ${tripleQuote}${tripleQuote}${tripleQuote}
            //selfieonce
            """
    val expected =
        """
            ${tripleQuote}
            ${tripleQuote}${tripleQuote}
            //selfieonce
            ${tripleQuote}${tripleQuote}${tripleQuote}

            """
    RemoveSelfieOnceComment.removeSelfieComment(input) shouldBe expected
  }

  @Test
  fun `code with multiple selfieonce comments should return unchanged`() {
    verifyUnchanged("code //selfieonce code //selfieonce")
  }

  @Test
  fun `selfieonce at start of file with content after should preserve content`() {
    RemoveSelfieOnceComment.removeSelfieComment("//selfieonce\nrest of file") shouldBe
        "\nrest of file"
  }

  @Test
  fun `selfieonce at end of file with content before should preserve content`() {
    RemoveSelfieOnceComment.removeSelfieComment("start of file\n//selfieonce") shouldBe
        "start of file\n"
  }

  @Test
  fun `mixed case SeLfIeOnCe should return unchanged`() {
    verifyUnchanged("//SeLfIeOnCe")
  }

  @Test
  fun `should remove when on new line which had commented triple string quote before`() {
    RemoveSelfieOnceComment.removeSelfieComment("//${tripleQuote}\n//selfieonce") shouldBe
        "//${tripleQuote}\n"
  }

  @Test
  fun `should remove selfieonce on new line which had commented triple string quote before`() {
    RemoveSelfieOnceComment.removeSelfieComment(
        """var s = "//"; // asdfds ${tripleQuote}${"\n"}//selfieonce""") shouldBe
        """var s = "//"; // asdfds ${tripleQuote}${"\n"}"""
  }

  @Test
  fun `selfieonce with tabs instead of spaces should be removed`() {
    RemoveSelfieOnceComment.removeSelfieComment("\t//\tselfieonce\t") shouldBe ""
  }

  @Test
  fun `selfieonce with unicode characters should return unchanged`() {
    verifyUnchanged("//selfieonce\u2022\u00A9\u00AE")
  }

  @Test
  fun `selfieonce in string with escaped quotes should return unchanged`() {
    verifyUnchanged("\"string with \\\"//selfieonce\\\" inside\"")
  }

  @Test
  fun `selfieonce with non-breaking space should return unchanged`() {
    verifyUnchanged("//selfieonce\u00A0")
  }

  @Test
  fun `selfieonce with backslashes should return unchanged`() {
    verifyUnchanged("//selfieonce\\path\\to\\file")
  }

  @Test
  fun `selfieonce with escaped characters should return unchanged`() {
    verifyUnchanged("//selfieonce\\n\\t\\r")
  }

  @Test
  fun `selfieonce with multiple consecutive slashes should return unchanged`() {
    verifyUnchanged("///selfieonce")
  }

  @Test
  fun `selfieonce at end of file without trailing newline should be removed`() {
    RemoveSelfieOnceComment.removeSelfieComment("code\n//selfieonce") shouldBe "code\n"
  }

  @Test
  fun `selfieonce with carriage return only should preserve CR`() {
    RemoveSelfieOnceComment.removeSelfieComment("//selfieonce\r") shouldBe "\r"
  }

  @Test
  fun `selfieonce with comment after code and newline should preserve code and newline`() {
    RemoveSelfieOnceComment.removeSelfieComment("val x = 10 //selfieonce\n") shouldBe "val x = 10\n"
  }

  @Test
  fun `should preserve selfieonce in java class when it is only in docs and string literals`() {
    val input =
        """
      /**
       * This is a sample Java class with Javadoc and selfieonce inside.
       * //selfieonce   
       */
      public class SampleJavaClass {

          /*
This is block comment with selfieonce inside.
//selfieonce
            */

          private String multilineString = ${tripleQuote}
This is multiline string with selfieonce inside.
//selfieonce
${tripleQuote};

          public void sampleMethod() {
              String anotherMultiLineString = ${tripleQuote}
This is another multiline string
${tripleQuote};
          }
      }
    """

    verifyUnchanged(input)
  }

  @Test
  fun `should remove selfieonce from java class only when not in javadoc or block comment and not in string literal`() {
    val input =
        """
      /**
       * This is a sample Java class with Javadoc.
       * //selfieonce   
       */
      public class SampleJavaClass {

          /*
This is block comment
//selfieonce
            */

          private String multilineString = ${tripleQuote}
This is multiline string
//selfieonce
${tripleQuote};

          //selfieonce
          public void sampleMethod() {
              String anotherMultiLineString = ${tripleQuote}
This is another multiline string
${tripleQuote};
          }
      }
    """
    val expected =
        """
      /**
       * This is a sample Java class with Javadoc.
       * //selfieonce   
       */
      public class SampleJavaClass {

          /*
This is block comment
//selfieonce
            */

          private String multilineString = ${tripleQuote}
This is multiline string
//selfieonce
${tripleQuote};


          public void sampleMethod() {
              String anotherMultiLineString = ${tripleQuote}
This is another multiline string
${tripleQuote};
          }
      }
    """

    RemoveSelfieOnceComment.removeSelfieComment(input) shouldBe expected
  }

  @Test
  fun `should remove all occurrences of selfieonce from java class only when not in javadoc or block comment and not in string literal`() {
    val input =
        """
          //selfieonce
      /**
       * This is a sample Java class with Javadoc.
       * //selfieonce   
       */
      public class SampleJavaClass {

          /*
This is block comment
//selfieonce
            */

          private String multilineString = ${tripleQuote}
This is multiline string
//selfieonce
${tripleQuote};

          //selfieonce
          public void sampleMethod() {
              String anotherMultiLineString = ${tripleQuote}
This is another multiline string
${tripleQuote};
          }
      }
//selfieonce
    """
    val expected =
        """

      /**
       * This is a sample Java class with Javadoc.
       * //selfieonce   
       */
      public class SampleJavaClass {

          /*
This is block comment
//selfieonce
            */

          private String multilineString = ${tripleQuote}
This is multiline string
//selfieonce
${tripleQuote};


          public void sampleMethod() {
              String anotherMultiLineString = ${tripleQuote}
This is another multiline string
${tripleQuote};
          }
      }

    """

    RemoveSelfieOnceComment.removeSelfieComment(input) shouldBe expected
  }

  @Test
  fun `selfieonce with line continuation character should return unchanged`() {
    verifyUnchanged("//selfieonce\\")
  }

  @Test
  fun `selfieonce with malformed syntax should return unchanged`() {
    verifyUnchanged("//selfie once")
    verifyUnchanged("// selfie once")
    verifyUnchanged("//selfieonc")
  }

  @Test
  fun `selfieonce in nested code blocks should be removed`() {
    val input =
        """
      function outer() {
        if (condition) {
          //selfieonce
          console.log("nested");
        }
      }
    """
    val expected =
        """
      function outer() {
        if (condition) {

          console.log("nested");
        }
      }
    """
    RemoveSelfieOnceComment.removeSelfieComment(input) shouldBe expected
  }

  @Test
  fun `selfieonce with mixed case and additional characters should return unchanged`() {
    verifyUnchanged("//SeLfIeOnCe+")
    verifyUnchanged("//selfieonce_extra")
    verifyUnchanged("//selfieonce-suffix")
  }

  @Test
  fun `selfieonce with trailing comment should return unchanged`() {
    verifyUnchanged("//selfieonce // this is another comment")
  }

  @Test
  fun `selfieonce at end of code line without trailing newline should be removed preserving code`() {
    RemoveSelfieOnceComment.removeSelfieComment("code line\nmore code//selfieonce") shouldBe
        "code line\nmore code"
  }

  @Test
  fun `selfieonce with extremely long whitespace before should be removed`() {
    val longWhitespace = " ".repeat(1000)
    RemoveSelfieOnceComment.removeSelfieComment("${longWhitespace}//selfieonce") shouldBe ""
  }

  @Test
  fun `selfieonce with extremely long whitespace after should be removed`() {
    val longWhitespace = " ".repeat(1000)
    RemoveSelfieOnceComment.removeSelfieComment("//selfieonce${longWhitespace}") shouldBe ""
  }

  @Test
  fun `selfieonce in the middle of multi-line statement should preserve code structure`() {
    val input =
        """
      val result = functionCall(
        param1,
        //selfieonce
        param2,
        param3
      )
    """
    val expected =
        """
      val result = functionCall(
        param1,

        param2,
        param3
      )
    """
    RemoveSelfieOnceComment.removeSelfieComment(input) shouldBe expected
  }

  @Test
  fun `selfieonce with mixed line endings in file should be removed preserving all line endings`() {
    val input = "line1\r\nline2\n//selfieonce\r\nline4\nline5"
    val expected = "line1\r\nline2\n\r\nline4\nline5"
    RemoveSelfieOnceComment.removeSelfieComment(input) shouldBe expected
  }

  @Test
  fun `selfieonce with escape sequences that might interfere with parsing should return unchanged`() {
    verifyUnchanged("//selfieonce\\\"\\\\")
  }

  @Test
  fun `selfieonce with unusual indentation patterns should be removed correctly`() {
    val input =
        """
      function() {
          if (condition) {
        //selfieonce
            doSomething();
          }
      }
    """
    val expected =
        """
      function() {
          if (condition) {

            doSomething();
          }
      }
    """
    RemoveSelfieOnceComment.removeSelfieComment(input) shouldBe expected
  }

  @Test
  fun `selfieonce with comment marker inside word should return unchanged`() {
    verifyUnchanged("word//selfieonce_inside_word")
  }

  @Test
  fun `selfieonce with multiple blank lines around should preserve blank lines`() {
    val input = """

      //selfieonce

    """
    val expected = """



    """
    RemoveSelfieOnceComment.removeSelfieComment(input) shouldBe expected
  }
  private fun verifyUnchanged(input: String) {
    RemoveSelfieOnceComment.removeSelfieComment(input) shouldBe input
  }
}
