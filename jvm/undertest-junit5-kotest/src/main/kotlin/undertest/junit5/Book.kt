package undertest.junit5

@kotlinx.serialization.Serializable
data class Book(val title: String, val author: String) : java.io.Serializable
