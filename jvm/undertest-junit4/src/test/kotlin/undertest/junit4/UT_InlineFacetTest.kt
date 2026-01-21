package undertest.junit4

import com.diffplug.selfie.Selfie.expectSelfie
import com.diffplug.selfie.Snapshot
import org.junit.Test

class UT_InlineFacetTest {
  @Test fun singleFacet() {
    val zero = Snapshot.of("no facets")
    expectSelfie(zero).toBe("no facets")
    expectSelfie(zero).facet("").toBe("no facets")
    expectSelfie(zero).facets("").toBe("no facets")
// Test expected exceptions
    try {
      expectSelfie(zero).toBe("WRONG")
      throw AssertionError("Expected exception was not thrown")
    } catch (e: Throwable) {}

    try {
      expectSelfie(zero).facet("").toBe("WRONG")
      throw AssertionError("Expected exception was not thrown")
    } catch (e: Throwable) {}

    try {
      expectSelfie(zero).facets("").toBe("WRONG")
      throw AssertionError("Expected exception was not thrown")
    } catch (e: Throwable) {}

    val one = Snapshot.of("subject").plusFacet("facet", "facetValue")
    expectSelfie(one).facet("").toBe("subject")
    expectSelfie(one).facets("").toBe("subject")
    expectSelfie(one).facet("facet").toBe("facetValue")
    expectSelfie(one).facets("facet").toBe("facetValue")

    try {
      expectSelfie(one).facet("").toBe("WRONG")
      throw AssertionError("Expected exception was not thrown")
    } catch (e: Throwable) {}

    try {
      expectSelfie(one).facets("").toBe("WRONG")
      throw AssertionError("Expected exception was not thrown")
    } catch (e: Throwable) {}

    try {
      expectSelfie(one).facet("facet").toBe("WRONG")
      throw AssertionError("Expected exception was not thrown")
    } catch (e: Throwable) {}

    try {
      expectSelfie(one).facets("facet").toBe("WRONG")
      throw AssertionError("Expected exception was not thrown")
    } catch (e: Throwable) {}
  }

  @Test fun multipleFacets() {
    val multiple =
        Snapshot.of("subject")
            .plusFacet("facet1", "facetValue1")
            .plusFacet("facet2", "facetValue2")
            .plusFacet("facet3", "facetValue3")
    expectSelfie(multiple)
        .toBe(
            """
            subject
            ╔═ [facet1] ═╗
            facetValue1
            ╔═ [facet2] ═╗
            facetValue2
            ╔═ [facet3] ═╗
            facetValue3
        """
                .trimIndent())

    try {
      expectSelfie(multiple).toBe("WRONG")
      throw AssertionError("Expected exception was not thrown")
    } catch (e: Throwable) {}

    expectSelfie(multiple)
        .facets("", "facet1")
        .toBe(
            """
            subject
            ╔═ [facet1] ═╗
            facetValue1
        """
                .trimIndent())

    try {
      expectSelfie(multiple).facets("", "facet1").toBe("WRONG")
      throw AssertionError("Expected exception was not thrown")
    } catch (e: Throwable) {}

    expectSelfie(multiple)
        .facets("facet3", "facet2")
        .toBe(
            """
            ╔═ [facet3] ═╗
            facetValue3
            ╔═ [facet2] ═╗
            facetValue2
        """
                .trimIndent())

    try {
      expectSelfie(multiple).facets("facet3", "facet2").toBe("WRONG")
      throw AssertionError("Expected exception was not thrown")
    } catch (e: Throwable) {}

    var exceptionMessage: String? = null
    try {
      expectSelfie(multiple)
          .facets("facet1", "")
          .toBe(
              """
              subject
              ╔═ [facet1] ═╗
              facetValue1
          """
                  .trimIndent())
    } catch (e: Throwable) {
      exceptionMessage = e.message
    }

    expectSelfie(exceptionMessage!!)
        .toBe(
            "If you're going to specify the subject facet (\"\"), you have to list it first, this was [facet1, ]")
  }
}
